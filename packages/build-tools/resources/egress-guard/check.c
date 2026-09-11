// Self-check run inside a simulator right after the guard is installed:
// proves the guard library is loaded in a freshly spawned process and that it
// behaves as the requested mode says. Exit 0 on success; 2 when the library is
// not loaded; 3 when it is loaded but did not behave; 1 on usage errors.
//
//   egress-guard-check --mode block|log
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <mach-o/dyld.h>
#include <netinet/in.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

// TEST-NET-1 (RFC 5737): never routed, so without the guard a non-blocking
// connect reports EINPROGRESS and nothing ever answers.
#define PROBE_ADDRESS "192.0.2.1"
#define PROBE_PORT 9

static int guard_loaded(void) {
  for (uint32_t i = 0; i < _dyld_image_count(); i++) {
    const char *name = _dyld_get_image_name(i);
    if (name != NULL && strstr(name, "egress-guard.dylib") != NULL) {
      return 1;
    }
  }
  return 0;
}

int main(int argc, char **argv) {
  const char *mode = "block";
  if (argc == 3 && strcmp(argv[1], "--mode") == 0) {
    mode = argv[2];
  } else if (argc != 1) {
    fprintf(stderr, "usage: egress-guard-check [--mode block|log]\n");
    return 1;
  }
  if (!guard_loaded()) {
    printf("egress-guard-check: the guard library is not loaded in this process\n");
    return 2;
  }

  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    printf("egress-guard-check: socket() failed: %s\n", strerror(errno));
    return 3;
  }
  fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
  struct sockaddr_in to;
  memset(&to, 0, sizeof to);
  to.sin_family = AF_INET;
  to.sin_len = sizeof to;
  to.sin_port = htons(PROBE_PORT);
  inet_pton(AF_INET, PROBE_ADDRESS, &to.sin_addr);
  int rc = connect(fd, (struct sockaddr *)&to, sizeof to);
  int err = errno;
  close(fd);

  if (strcmp(mode, "block") == 0) {
    if (rc == -1 && err == ECONNREFUSED) {
      printf("egress-guard-check: guard loaded; non-loopback connections are refused\n");
      return 0;
    }
    printf("egress-guard-check: guard loaded but a non-loopback connect was not refused (rc=%d, errno=%d %s)\n",
           rc, err, strerror(err));
    return 3;
  }
  if (rc == 0 || (rc == -1 && err == EINPROGRESS)) {
    printf("egress-guard-check: guard loaded in log mode; connections pass through\n");
    return 0;
  }
  printf("egress-guard-check: guard loaded in log mode but connect failed (errno=%d %s)\n", err,
         strerror(err));
  return 3;
}
