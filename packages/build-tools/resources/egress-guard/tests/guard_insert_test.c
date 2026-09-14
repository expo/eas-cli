// Black-box host tests of the built guard, loaded through
// DYLD_INSERT_LIBRARIES like the simulator does. Remote calls use fd -1 or are
// refused before the kernel; the only real sockets are on loopback. Build and
// run with tests/run-guard-tests.sh.
//
//   guard-insert-test <case> <log-path> [<extra-path>]
#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/uio.h>
#include <unistd.h>

typedef int (*connect_fn)(int, const struct sockaddr *, socklen_t);
typedef ssize_t (*sendto_fn)(int, const void *, size_t, int, const struct sockaddr *, socklen_t);
typedef ssize_t (*sendmsg_fn)(int, const struct msghdr *, int);

static struct sockaddr_in remote(int port) {
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_len = sizeof a;
  a.sin_port = htons(port);
  inet_pton(AF_INET, "192.0.2.1", &a.sin_addr);
  return a;
}

static struct sockaddr_in6 remote6(int port) {
  struct sockaddr_in6 a;
  memset(&a, 0, sizeof a);
  a.sin6_family = AF_INET6;
  a.sin6_len = sizeof a;
  a.sin6_port = htons(port);
  inet_pton(AF_INET6, "2001:db8::1", &a.sin6_addr);
  return a;
}

static int refused_sendto(int port) {
  struct sockaddr_in to = remote(port);
  errno = 0;
  return sendto(-1, "x", 1, 0, (struct sockaddr *)&to, sizeof to) == -1 && errno == ECONNREFUSED;
}

static off_t file_size(const char *path) {
  struct stat st;
  return stat(path, &st) == 0 ? st.st_size : -1;
}

static int count_lines(const char *path, const char *needle) {
  FILE *f = fopen(path, "r");
  if (f == NULL) {
    return -1;
  }
  int count = 0;
  char line[1024];
  while (fgets(line, sizeof line, f)) {
    if (strstr(line, needle)) {
      count++;
    }
  }
  fclose(f);
  return count;
}

// Daemon-style cleanup: close every descriptor the process does not know
// about, then open an application file. The guard's event must land in the
// event log, not in that file.
static int fd_reuse(const char *log_path, const char *app_path) {
  for (int fd = 3; fd < getdtablesize(); fd++) {
    close(fd);
  }
  int app_fd = open(app_path, O_CREAT | O_TRUNC | O_WRONLY, 0600);
  if (app_fd < 0 || !refused_sendto(9)) {
    return 2;
  }
  close(app_fd);
  if (file_size(app_path) != 0) {
    printf("FAIL fd-reuse: %lld bytes written into an unrelated file\n",
           (long long)file_size(app_path));
    return 1;
  }
  if (count_lines(log_path, "\tsendto\tblocked\t192.0.2.1:9\t") != 1) {
    printf("FAIL fd-reuse: event missing from the event log\n");
    return 1;
  }
  return 0;
}

// Started with stdout closed, as the runner arranges: the process's own stdout
// output must not end up in the event log, and the event must.
static int low_fd(const char *log_path) {
  printf("STDOUT-LINE\n");
  fflush(stdout);
  if (!refused_sendto(9)) {
    return 2;
  }
  if (count_lines(log_path, "STDOUT-LINE") != 0) {
    return 1;
  }
  return count_lines(log_path, "\tsendto\tblocked\t192.0.2.1:9\t") == 1 ? 0 : 1;
}

static int nocancel(void) {
  connect_fn nc_connect = (connect_fn)dlsym(RTLD_DEFAULT, "connect$NOCANCEL");
  sendto_fn nc_sendto = (sendto_fn)dlsym(RTLD_DEFAULT, "sendto$NOCANCEL");
  sendmsg_fn nc_sendmsg = (sendmsg_fn)dlsym(RTLD_DEFAULT, "sendmsg$NOCANCEL");
  if (!nc_connect || !nc_sendto || !nc_sendmsg) {
    return 2;
  }
  struct sockaddr_in to = remote(443);
  int failures = 0;
  errno = 0;
  if (nc_connect(-1, (struct sockaddr *)&to, sizeof to) != -1 || errno != ECONNREFUSED) {
    printf("FAIL nocancel: connect$NOCANCEL not refused (errno %d)\n", errno);
    failures++;
  }
  errno = 0;
  if (nc_sendto(-1, "x", 1, 0, (struct sockaddr *)&to, sizeof to) != -1 || errno != ECONNREFUSED) {
    printf("FAIL nocancel: sendto$NOCANCEL not refused (errno %d)\n", errno);
    failures++;
  }
  char payload[] = "x";
  struct iovec iov = {.iov_base = payload, .iov_len = 1};
  struct msghdr msg = {.msg_name = &to, .msg_namelen = sizeof to, .msg_iov = &iov, .msg_iovlen = 1};
  errno = 0;
  if (nc_sendmsg(-1, &msg, 0) != -1 || errno != ECONNREFUSED) {
    printf("FAIL nocancel: sendmsg$NOCANCEL not refused (errno %d)\n", errno);
    failures++;
  }
  return failures ? 1 : 0;
}

// The shapes the kernel accepts as IPv4/IPv6 despite sa_family == AF_UNSPEC.
static int unspec(void) {
  int failures = 0;
  struct sockaddr_in to = remote(443);
  to.sin_family = AF_UNSPEC;
  int tcp = socket(AF_INET, SOCK_STREAM, 0);
  errno = 0;
  if (connect(tcp, (struct sockaddr *)&to, sizeof to) != -1 || errno != ECONNREFUSED) {
    printf("FAIL unspec: TCP connect with AF_UNSPEC not refused (errno %d)\n", errno);
    failures++;
  }
  close(tcp);
  struct sockaddr_in6 to6 = remote6(443);
  to6.sin6_family = AF_UNSPEC;
  int tcp6 = socket(AF_INET6, SOCK_STREAM, 0);
  errno = 0;
  if (connect(tcp6, (struct sockaddr *)&to6, sizeof to6) != -1 || errno != ECONNREFUSED) {
    printf("FAIL unspec: TCP6 connect with AF_UNSPEC not refused (errno %d)\n", errno);
    failures++;
  }
  close(tcp6);
  errno = 0;
  if (sendto(-1, "x", 1, 0, (struct sockaddr *)&to, sizeof to) != -1 || errno != ECONNREFUSED) {
    printf("FAIL unspec: sendto with AF_UNSPEC not refused (errno %d)\n", errno);
    failures++;
  }
  char payload[] = "x";
  struct iovec iov = {.iov_base = payload, .iov_len = 1};
  struct msghdr msg = {.msg_name = &to, .msg_namelen = sizeof to, .msg_iov = &iov, .msg_iovlen = 1};
  errno = 0;
  if (sendmsg(-1, &msg, 0) != -1 || errno != ECONNREFUSED) {
    printf("FAIL unspec: sendmsg with AF_UNSPEC not refused (errno %d)\n", errno);
    failures++;
  }
  return failures ? 1 : 0;
}

// A UDP socket associated with loopback dissolves the association through
// connect(AF_UNSPEC), whatever address bytes follow the family. The guard
// must let the kernel do that.
static int udp_disconnect(void) {
  int fd = socket(AF_INET, SOCK_DGRAM, 0);
  struct sockaddr_in loopback;
  memset(&loopback, 0, sizeof loopback);
  loopback.sin_family = AF_INET;
  loopback.sin_len = sizeof loopback;
  loopback.sin_port = htons(9);
  loopback.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (connect(fd, (struct sockaddr *)&loopback, sizeof loopback) != 0) {
    return 2;
  }
  struct sockaddr_in peer;
  socklen_t peer_len = sizeof peer;
  if (getpeername(fd, (struct sockaddr *)&peer, &peer_len) != 0) {
    return 2;
  }
  int failures = 0;
  for (int stale = 0; stale < 2; stale++) {
    struct sockaddr_in dissolve = stale ? remote(443) : loopback;
    if (!stale) {
      memset(&dissolve, 0, sizeof dissolve);
      dissolve.sin_len = sizeof dissolve;
    }
    dissolve.sin_family = AF_UNSPEC;
    if (connect(fd, (struct sockaddr *)&loopback, sizeof loopback) != 0) {
      return 2;
    }
    errno = 0;
    int rc = connect(fd, (struct sockaddr *)&dissolve, sizeof dissolve);
    int err = errno;
    peer_len = sizeof peer;
    int still_connected = getpeername(fd, (struct sockaddr *)&peer, &peer_len) == 0;
    if (rc != -1 || err != EAFNOSUPPORT || still_connected) {
      printf("FAIL udp-disconnect (%s address): rc=%d errno=%d still_connected=%d\n",
             stale ? "stale remote" : "zeroed", rc, err, still_connected);
      failures++;
    }
  }
  close(fd);
  return failures ? 1 : 0;
}

// Past 128 distinct destinations a process writes one overflow line and
// nothing more; refusal continues.
static int overflow(const char *log_path) {
  for (int port = 1; port <= 140; port++) {
    if (!refused_sendto(port)) {
      return 2;
    }
  }
  int listed = count_lines(log_path, "\tsendto\tblocked\t192.0.2.1:");
  int overflow_lines = count_lines(log_path, "\toverflow\tblocked\t128 distinct destinations\t");
  if (listed != 128 || overflow_lines != 1) {
    printf("FAIL overflow: %d destinations listed, %d overflow line(s)\n", listed, overflow_lines);
    return 1;
  }
  return 0;
}

// The event names the images above the guard, not the guard itself.
static int callers(const char *log_path) {
  if (!refused_sendto(9)) {
    return 2;
  }
  FILE *f = fopen(log_path, "r");
  if (f == NULL) {
    return 2;
  }
  char line[1024];
  int ok = 0;
  while (fgets(line, sizeof line, f)) {
    if (strstr(line, "\tsendto\tblocked\t192.0.2.1:9\t")) {
      const char *callers_field = strrchr(line, '\t') + 1;
      ok = strstr(callers_field, "guard-insert-test") != NULL &&
           strstr(callers_field, "egress-guard") == NULL;
      if (!ok) {
        printf("FAIL callers: %s", line);
      }
    }
  }
  fclose(f);
  return ok ? 0 : 1;
}

int main(int argc, char **argv) {
  if (argc < 3) {
    return 2;
  }
  const char *name = argv[1];
  const char *log_path = argv[2];
  if (strcmp(name, "fd-reuse") == 0) {
    return argc == 4 ? fd_reuse(log_path, argv[3]) : 2;
  }
  if (strcmp(name, "low-fd") == 0) {
    return low_fd(log_path);
  }
  if (strcmp(name, "nocancel") == 0) {
    return nocancel();
  }
  if (strcmp(name, "unspec") == 0) {
    return unspec();
  }
  if (strcmp(name, "udp-disconnect") == 0) {
    return udp_disconnect();
  }
  if (strcmp(name, "callers") == 0) {
    return callers(log_path);
  }
  if (strcmp(name, "overflow") == 0) {
    return overflow(log_path);
  }
  return 2;
}
