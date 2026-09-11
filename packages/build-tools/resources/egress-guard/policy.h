// Policy and formatting for the local egress guard. Pure functions with no
// interposing, so they compile and test on macOS as well as in the simulator.
#ifndef EAS_EGRESS_GUARD_POLICY_H
#define EAS_EGRESS_GUARD_POLICY_H

#include <stddef.h>
#include <sys/socket.h>

// What a destination address is, as far as the guard cares.
typedef enum {
  EG_PASSTHROUGH = 0,  // not an internet address (unix sockets, NULL, short); never touched
  EG_LOOPBACK = 1,     // 127.0.0.0/8, ::1, ::ffff:127.x, unspecified; the proxy and forwards live here
  EG_REMOTE = 2,       // anything else, including link-local and multicast
} eg_class_t;

typedef enum {
  EG_MODE_BLOCK = 0,  // refuse EG_REMOTE with ECONNREFUSED
  EG_MODE_LOG = 1,    // observe only
} eg_mode_t;

eg_class_t eg_classify(const struct sockaddr *sa, socklen_t len);

// "block" or unset selects block; "log" selects log. Anything else is block:
// an unknown mode must fail closed.
eg_mode_t eg_parse_mode(const char *value);

int eg_should_deny(eg_mode_t mode, eg_class_t cls);

// Writes "1.2.3.4:443" or "[2001:db8::1]:443". Returns 0 on success.
int eg_format_peer(const struct sockaddr *sa, socklen_t len, char *out, size_t n);

// Fixed-capacity set of strings, so a retrying client logs a destination once
// per process instead of once per attempt.
#define EG_SEEN_CAPACITY 128
#define EG_SEEN_KEY_LENGTH 192
typedef struct {
  char keys[EG_SEEN_CAPACITY][EG_SEEN_KEY_LENGTH];
  int count;
  int overflow;  // insertions refused because the table was full
} eg_seen_t;

// 1 when the key was not present and was inserted; 0 when already present or
// when the table is full (counted in overflow).
int eg_seen_insert(eg_seen_t *seen, const char *key);

#define EG_EVENT_PREFIX "eas-egress-guard"

// One tab-separated line, newline terminated:
//   eas-egress-guard\t<progname>\t<pid>\t<function>\t<action>\t<peer>\t<caller>,<caller>...\n
// Tabs and newlines inside fields are replaced with spaces. Returns the length
// written, or -1 when it does not fit.
int eg_format_event(char *out, size_t n, const char *progname, int pid, const char *function,
                    const char *action, const char *peer, const char *const *callers,
                    int caller_count);

#endif
