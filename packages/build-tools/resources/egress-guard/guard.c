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

static int eg_initialized = 0;
static int eg_log_fd = -1;
static eg_mode_t eg_mode = EG_MODE_BLOCK;
static eg_seen_t eg_seen;
static os_unfair_lock eg_lock = OS_UNFAIR_LOCK_INIT;

static void eg_init(void) {
  if (eg_initialized) {
    return;
  }
  eg_mode = eg_parse_mode(getenv(EG_MODE_ENV));
  const char *log_path = getenv(EG_LOG_ENV);
  if (log_path != NULL && log_path[0] != '\0') {
    // O_APPEND keeps whole lines intact across processes writing concurrently.
    eg_log_fd = open(log_path, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0644);
  }
  eg_initialized = 1;
}

__attribute__((constructor)) static void eg_constructor(void) { eg_init(); }

// Image names of the frames above the interposer, innermost first, with
// consecutive repeats collapsed: "Network,CFNetwork,MyApp".
__attribute__((noinline)) static int eg_collect_callers(char names[EG_MAX_CALLERS][EG_CALLER_LENGTH]) {
  void *frames[EG_MAX_CALLERS + 4];
  int frame_count = backtrace(frames, EG_MAX_CALLERS + 4);
  int count = 0;
  // frames[0] is this function, frames[1] eg_handle, frames[2] the interposer.
  for (int i = 3; i < frame_count && count < EG_MAX_CALLERS; i++) {
    Dl_info info;
    const char *image = "?";
    if (dladdr(frames[i], &info) && info.dli_fname != NULL) {
      const char *slash = strrchr(info.dli_fname, '/');
      image = slash ? slash + 1 : info.dli_fname;
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
  os_unfair_lock_lock(&eg_lock);
  int fresh = eg_seen_insert(&eg_seen, key);
  os_unfair_lock_unlock(&eg_lock);

  if (fresh && eg_log_fd >= 0) {
    char names[EG_MAX_CALLERS][EG_CALLER_LENGTH];
    int caller_count = eg_collect_callers(names);
    const char *callers[EG_MAX_CALLERS];
    for (int i = 0; i < caller_count; i++) {
      callers[i] = names[i];
    }
    char line[1024];
    int n = eg_format_event(line, sizeof line, getprogname(), getpid(), function,
                            deny ? "blocked" : "logged", peer, callers, caller_count);
    if (n > 0) {
      (void)write(eg_log_fd, line, (size_t)n);
    }
  }
  return deny;
}

static int eg_connect(int fd, const struct sockaddr *sa, socklen_t len) {
  if (eg_handle("connect", sa, len)) {
    errno = ECONNREFUSED;
    return -1;
  }
  return connect(fd, sa, len);
}

static int eg_connectx(int s, const sa_endpoints_t *endpoints, sae_associd_t associd,
                       unsigned int flags, const struct iovec *iov, unsigned int iovcnt,
                       size_t *len, sae_connid_t *connid) {
  if (endpoints != NULL && endpoints->sae_dstaddr != NULL &&
      eg_handle("connectx", endpoints->sae_dstaddr, endpoints->sae_dstaddrlen)) {
    errno = ECONNREFUSED;
    return -1;
  }
  return connectx(s, endpoints, associd, flags, iov, iovcnt, len, connid);
}

static ssize_t eg_sendto(int fd, const void *buf, size_t n, int flags, const struct sockaddr *sa,
                         socklen_t len) {
  if (sa != NULL && eg_handle("sendto", sa, len)) {
    errno = ECONNREFUSED;
    return -1;
  }
  return sendto(fd, buf, n, flags, sa, len);
}

static ssize_t eg_sendmsg(int fd, const struct msghdr *msg, int flags) {
  if (msg != NULL && msg->msg_name != NULL && msg->msg_namelen > 0 &&
      eg_handle("sendmsg", (const struct sockaddr *)msg->msg_name, msg->msg_namelen)) {
    errno = ECONNREFUSED;
    return -1;
  }
  return sendmsg(fd, msg, flags);
}

// dyld applies these to every image in the process, including the shared
// cache, which is how calls made inside CFNetwork and Network.framework are
// caught.
__attribute__((used)) static const struct {
  const void *replacement;
  const void *original;
} eg_interposers[] __attribute__((section("__DATA,__interpose"))) = {
    {(const void *)eg_connect, (const void *)connect},
    {(const void *)eg_connectx, (const void *)connectx},
    {(const void *)eg_sendto, (const void *)sendto},
    {(const void *)eg_sendmsg, (const void *)sendmsg},
};
