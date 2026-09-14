// The local egress guard: interposes the calls that open outbound traffic in
// every simulator process it is inserted into, refuses non-loopback
// destinations in block mode, and records one event per destination per
// process. See README.md and policy.h.
#include "policy.h"

#include <dlfcn.h>
#include <errno.h>
#include <execinfo.h>
#include <fcntl.h>
#include <os/lock.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>

#define EG_LOG_ENV "EAS_EGRESS_GUARD_LOG"
#define EG_MODE_ENV "EAS_EGRESS_GUARD_MODE"
#define EG_MAX_CALLERS 6
#define EG_CALLER_LENGTH 64
#define EG_LOCK_ATTEMPTS 64

static int eg_initialized = 0;
static void *eg_own_image = NULL;
static char eg_log_path[1024];
static eg_mode_t eg_mode = EG_MODE_BLOCK;
static eg_seen_t eg_seen;
static int eg_overflow_reported = 0;
static os_unfair_lock eg_lock = OS_UNFAIR_LOCK_INIT;

static void eg_init(void) {
  if (eg_initialized) {
    return;
  }
  eg_mode = eg_parse_mode(getenv(EG_MODE_ENV));
  Dl_info self;
  if (dladdr((const void *)eg_init, &self)) {
    eg_own_image = self.dli_fbase;
  }
  const char *log_path = getenv(EG_LOG_ENV);
  // The path is kept rather than an open descriptor: a process that closes
  // descriptors it does not know about (launchd_sim does) would otherwise
  // leave the guard writing into whatever file reused the number.
  if (log_path != NULL && log_path[0] != '\0' && strlen(log_path) < sizeof eg_log_path) {
    strcpy(eg_log_path, log_path);
  }
  eg_initialized = 1;
}

__attribute__((constructor)) static void eg_constructor(void) { eg_init(); }

// Image names of the frames above the guard's own, innermost first, with
// consecutive repeats collapsed: "Network,CFNetwork,MyApp".
__attribute__((noinline)) static int eg_collect_callers(char names[EG_MAX_CALLERS][EG_CALLER_LENGTH]) {
  void *frames[EG_MAX_CALLERS + 6];
  int frame_count = backtrace(frames, EG_MAX_CALLERS + 6);
  int count = 0;
  for (int i = 1; i < frame_count && count < EG_MAX_CALLERS; i++) {
    Dl_info info;
    const char *image = "?";
    if (dladdr(frames[i], &info)) {
      if (info.dli_fbase == eg_own_image) {
        continue;
      }
      if (info.dli_fname != NULL) {
        const char *slash = strrchr(info.dli_fname, '/');
        image = slash ? slash + 1 : info.dli_fname;
      }
    }
    if (count > 0 && strcmp(names[count - 1], image) == 0) {
      continue;
    }
    strncpy(names[count], image, EG_CALLER_LENGTH - 1);
    names[count][EG_CALLER_LENGTH - 1] = '\0';
    count++;
  }
  return count;
}

// A lock held by this same thread (a signal handler making a socket call
// while the interrupted call held it) or by a thread that did not survive
// fork() never becomes available and os_unfair_lock_lock aborts the process
// in both cases. Give up on recording the event instead; refusal does not
// depend on it. Ordinary contention over the microsecond-long critical
// section resolves within the first attempts.
static int eg_lock_bounded(void) {
  for (int i = 0; i < EG_LOCK_ATTEMPTS; i++) {
    if (os_unfair_lock_trylock(&eg_lock)) {
      return 1;
    }
    sched_yield();
  }
  return 0;
}

// One line in the event log. O_APPEND keeps whole lines intact across
// processes writing concurrently; the log is opened per event, at most
// EG_SEEN_CAPACITY + 1 times per process.
__attribute__((noinline)) static void eg_write_event(const char *function, const char *action,
                                                     const char *peer, int with_callers) {
  if (eg_log_path[0] == '\0') {
    return;
  }
  char names[EG_MAX_CALLERS][EG_CALLER_LENGTH];
  const char *callers[EG_MAX_CALLERS];
  int caller_count = with_callers ? eg_collect_callers(names) : 0;
  for (int i = 0; i < caller_count; i++) {
    callers[i] = names[i];
  }
  char line[1024];
  int n = eg_format_event(line, sizeof line, getprogname(), getpid(), function, action, peer,
                          callers, caller_count);
  if (n <= 0) {
    return;
  }
  int fd = open(eg_log_path, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0644);
  if (fd >= 0) {
    (void)write(fd, line, (size_t)n);
    close(fd);
  }
}

// Returns 1 when the call must be refused.
__attribute__((noinline)) static int eg_handle(const char *function, const struct sockaddr *sa,
                                              socklen_t len) {
  eg_class_t cls = eg_classify(sa, len);
  if (cls != EG_REMOTE) {
    return 0;
  }
  eg_init();
  int deny = eg_should_deny(eg_mode, cls);

  char peer[96];
  if (eg_format_peer(sa, len, peer, sizeof peer) != 0) {
    strncpy(peer, "?", sizeof peer);
  }
  char key[EG_SEEN_KEY_LENGTH];
  snprintf(key, sizeof key, "%s %s", function, peer);
  int fresh = 0;
  int overflowed = 0;
  if (eg_lock_bounded()) {
    fresh = eg_seen_insert(&eg_seen, key);
    if (!fresh && eg_seen.overflow > 0 && !eg_overflow_reported) {
      eg_overflow_reported = 1;
      overflowed = 1;
    }
    os_unfair_lock_unlock(&eg_lock);
  }

  const char *action = deny ? "blocked" : "logged";
  if (fresh) {
    eg_write_event(function, action, peer, 1);
  } else if (overflowed) {
    // Once per process: the table is full, so further distinct destinations
    // are still refused but no longer listed.
    char limit[64];
    snprintf(limit, sizeof limit, "%d distinct destinations", EG_SEEN_CAPACITY);
    eg_write_event(EG_OVERFLOW_FUNCTION, action, limit, 0);
  }
  return deny;
}

// connect() with an AF_UNSPEC address on a datagram socket dissolves the
// association and sends nothing; the kernel answers EAFNOSUPPORT. Leave that
// to the kernel. On a stream socket the kernel connects to the address the
// length implies, which eg_handle classifies.
static int eg_dissolves_association(int fd, const struct sockaddr *sa, socklen_t len) {
  if (sa == NULL || len < 2 || sa->sa_family != AF_UNSPEC) {
    return 0;
  }
  int type = 0;
  socklen_t type_len = sizeof type;
  return getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &type_len) == 0 && type == SOCK_DGRAM;
}

typedef int (*eg_connect_fn)(int, const struct sockaddr *, socklen_t);
typedef ssize_t (*eg_sendto_fn)(int, const void *, size_t, int, const struct sockaddr *,
                                socklen_t);
typedef ssize_t (*eg_sendmsg_fn)(int, const struct msghdr *, int);

// The non-cancelable variants libsystem_kernel exports next to the cancelable
// ones; dyld interposing is per symbol, so each needs its own entry.
extern int eg_connect_nocancel_original(int, const struct sockaddr *, socklen_t) __asm__(
    "_connect$NOCANCEL");
extern ssize_t eg_sendto_nocancel_original(int, const void *, size_t, int,
                                           const struct sockaddr *, socklen_t) __asm__(
    "_sendto$NOCANCEL");
extern ssize_t eg_sendmsg_nocancel_original(int, const struct msghdr *, int) __asm__(
    "_sendmsg$NOCANCEL");

static int eg_connect_through(eg_connect_fn original, int fd, const struct sockaddr *sa,
                              socklen_t len) {
  if (!eg_dissolves_association(fd, sa, len) && eg_handle("connect", sa, len)) {
    errno = ECONNREFUSED;
    return -1;
  }
  return original(fd, sa, len);
}

static int eg_connect(int fd, const struct sockaddr *sa, socklen_t len) {
  return eg_connect_through(connect, fd, sa, len);
}

static int eg_connect_nocancel(int fd, const struct sockaddr *sa, socklen_t len) {
  return eg_connect_through(eg_connect_nocancel_original, fd, sa, len);
}

static int eg_connectx(int s, const sa_endpoints_t *endpoints, sae_associd_t associd,
                       unsigned int flags, const struct iovec *iov, unsigned int iovcnt,
                       size_t *len, sae_connid_t *connid) {
  if (endpoints != NULL && endpoints->sae_dstaddr != NULL &&
      !eg_dissolves_association(s, endpoints->sae_dstaddr, endpoints->sae_dstaddrlen) &&
      eg_handle("connectx", endpoints->sae_dstaddr, endpoints->sae_dstaddrlen)) {
    errno = ECONNREFUSED;
    return -1;
  }
  return connectx(s, endpoints, associd, flags, iov, iovcnt, len, connid);
}

static ssize_t eg_sendto_through(eg_sendto_fn original, int fd, const void *buf, size_t n,
                                 int flags, const struct sockaddr *sa, socklen_t len) {
  if (sa != NULL && eg_handle("sendto", sa, len)) {
    errno = ECONNREFUSED;
    return -1;
  }
  return original(fd, buf, n, flags, sa, len);
}

static ssize_t eg_sendto(int fd, const void *buf, size_t n, int flags, const struct sockaddr *sa,
                         socklen_t len) {
  return eg_sendto_through(sendto, fd, buf, n, flags, sa, len);
}

static ssize_t eg_sendto_nocancel(int fd, const void *buf, size_t n, int flags,
                                  const struct sockaddr *sa, socklen_t len) {
  return eg_sendto_through(eg_sendto_nocancel_original, fd, buf, n, flags, sa, len);
}

static ssize_t eg_sendmsg_through(eg_sendmsg_fn original, int fd, const struct msghdr *msg,
                                  int flags) {
  if (msg != NULL && msg->msg_name != NULL && msg->msg_namelen > 0 &&
      eg_handle("sendmsg", (const struct sockaddr *)msg->msg_name, msg->msg_namelen)) {
    errno = ECONNREFUSED;
    return -1;
  }
  return original(fd, msg, flags);
}

static ssize_t eg_sendmsg(int fd, const struct msghdr *msg, int flags) {
  return eg_sendmsg_through(sendmsg, fd, msg, flags);
}

static ssize_t eg_sendmsg_nocancel(int fd, const struct msghdr *msg, int flags) {
  return eg_sendmsg_through(eg_sendmsg_nocancel_original, fd, msg, flags);
}

// dyld applies these to every image in the process, including the shared
// cache, which is how calls made inside CFNetwork and Network.framework are
// caught.
__attribute__((used)) static const struct {
  const void *replacement;
  const void *original;
} eg_interposers[] __attribute__((section("__DATA,__interpose"))) = {
    {(const void *)eg_connect, (const void *)connect},
    {(const void *)eg_connect_nocancel, (const void *)eg_connect_nocancel_original},
    {(const void *)eg_connectx, (const void *)connectx},
    {(const void *)eg_sendto, (const void *)sendto},
    {(const void *)eg_sendto_nocancel, (const void *)eg_sendto_nocancel_original},
    {(const void *)eg_sendmsg, (const void *)sendmsg},
    {(const void *)eg_sendmsg_nocancel, (const void *)eg_sendmsg_nocancel_original},
};
