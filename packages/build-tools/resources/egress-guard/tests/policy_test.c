// Host-runnable tests for the guard's policy and formatting. Build and run
// with tests/run-policy-tests.sh; every failure prints the failing line.
#include "../policy.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdio.h>
#include <string.h>
#include <sys/un.h>

static int failures = 0;
#define CHECK(cond)                                                     \
  do {                                                                  \
    if (!(cond)) {                                                      \
      failures++;                                                       \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);   \
    }                                                                   \
  } while (0)

static struct sockaddr_in v4(const char *ip, int port) {
  struct sockaddr_in a; memset(&a, 0, sizeof a);
  a.sin_family = AF_INET; a.sin_len = sizeof a; a.sin_port = htons(port);
  inet_pton(AF_INET, ip, &a.sin_addr);
  return a;
}
static struct sockaddr_in6 v6(const char *ip, int port) {
  struct sockaddr_in6 a; memset(&a, 0, sizeof a);
  a.sin6_family = AF_INET6; a.sin6_len = sizeof a; a.sin6_port = htons(port);
  inet_pton(AF_INET6, ip, &a.sin6_addr);
  return a;
}

static void test_classify(void) {
  struct sockaddr_in a4; struct sockaddr_in6 a6; struct sockaddr_un un;

  a4 = v4("127.0.0.1", 8899); CHECK(eg_classify((struct sockaddr *)&a4, sizeof a4) == EG_LOOPBACK);
  a4 = v4("127.42.0.9", 80);  CHECK(eg_classify((struct sockaddr *)&a4, sizeof a4) == EG_LOOPBACK);
  a4 = v4("0.0.0.0", 80);     CHECK(eg_classify((struct sockaddr *)&a4, sizeof a4) == EG_LOOPBACK);
  a4 = v4("93.184.216.34", 443); CHECK(eg_classify((struct sockaddr *)&a4, sizeof a4) == EG_REMOTE);
  a4 = v4("192.168.1.10", 8081); CHECK(eg_classify((struct sockaddr *)&a4, sizeof a4) == EG_REMOTE);
  a4 = v4("169.254.1.1", 80);    CHECK(eg_classify((struct sockaddr *)&a4, sizeof a4) == EG_REMOTE);
  a4 = v4("224.0.0.251", 5353);  CHECK(eg_classify((struct sockaddr *)&a4, sizeof a4) == EG_REMOTE);

  a6 = v6("::1", 8899);                CHECK(eg_classify((struct sockaddr *)&a6, sizeof a6) == EG_LOOPBACK);
  a6 = v6("::", 80);                   CHECK(eg_classify((struct sockaddr *)&a6, sizeof a6) == EG_LOOPBACK);
  a6 = v6("::ffff:127.0.0.1", 8899);   CHECK(eg_classify((struct sockaddr *)&a6, sizeof a6) == EG_LOOPBACK);
  a6 = v6("::ffff:93.184.216.34", 443); CHECK(eg_classify((struct sockaddr *)&a6, sizeof a6) == EG_REMOTE);
  a6 = v6("2606:4700::1", 443);        CHECK(eg_classify((struct sockaddr *)&a6, sizeof a6) == EG_REMOTE);
  a6 = v6("fe80::1", 443);             CHECK(eg_classify((struct sockaddr *)&a6, sizeof a6) == EG_REMOTE);

  memset(&un, 0, sizeof un); un.sun_family = AF_UNIX; strcpy(un.sun_path, "/var/run/mDNSResponder");
  CHECK(eg_classify((struct sockaddr *)&un, sizeof un) == EG_PASSTHROUGH);
  CHECK(eg_classify(NULL, 0) == EG_PASSTHROUGH);
  a4 = v4("93.184.216.34", 443); CHECK(eg_classify((struct sockaddr *)&a4, 4) == EG_PASSTHROUGH);  // too short to read
}

static void test_mode(void) {
  CHECK(eg_parse_mode(NULL) == EG_MODE_BLOCK);
  CHECK(eg_parse_mode("") == EG_MODE_BLOCK);
  CHECK(eg_parse_mode("block") == EG_MODE_BLOCK);
  CHECK(eg_parse_mode("log") == EG_MODE_LOG);
  CHECK(eg_parse_mode("LOG") == EG_MODE_BLOCK);
  CHECK(eg_parse_mode("permissive") == EG_MODE_BLOCK);

  CHECK(eg_should_deny(EG_MODE_BLOCK, EG_REMOTE) == 1);
  CHECK(eg_should_deny(EG_MODE_BLOCK, EG_LOOPBACK) == 0);
  CHECK(eg_should_deny(EG_MODE_BLOCK, EG_PASSTHROUGH) == 0);
  CHECK(eg_should_deny(EG_MODE_LOG, EG_REMOTE) == 0);
}

static void test_format_peer(void) {
  char out[64];
  struct sockaddr_in a4 = v4("93.184.216.34", 443);
  CHECK(eg_format_peer((struct sockaddr *)&a4, sizeof a4, out, sizeof out) == 0);
  CHECK(strcmp(out, "93.184.216.34:443") == 0);
  struct sockaddr_in6 a6 = v6("2606:4700::1", 443);
  CHECK(eg_format_peer((struct sockaddr *)&a6, sizeof a6, out, sizeof out) == 0);
  CHECK(strcmp(out, "[2606:4700::1]:443") == 0);
  CHECK(eg_format_peer((struct sockaddr *)&a4, sizeof a4, out, 8) != 0);
  struct sockaddr_un un; memset(&un, 0, sizeof un); un.sun_family = AF_UNIX;
  CHECK(eg_format_peer((struct sockaddr *)&un, sizeof un, out, sizeof out) != 0);
}

static void test_seen(void) {
  static eg_seen_t seen; memset(&seen, 0, sizeof seen);
  CHECK(eg_seen_insert(&seen, "connect 1.1.1.1:443") == 1);
  CHECK(eg_seen_insert(&seen, "connect 1.1.1.1:443") == 0);
  CHECK(eg_seen_insert(&seen, "sendto 1.1.1.1:443") == 1);
  CHECK(seen.count == 2);
  char key[64];
  for (int i = 0; i < EG_SEEN_CAPACITY + 5; i++) { snprintf(key, sizeof key, "k%d", i); eg_seen_insert(&seen, key); }
  CHECK(seen.count == EG_SEEN_CAPACITY);
  CHECK(seen.overflow == 7);  // 2 + 128 + 5 attempts, 128 fit
  CHECK(eg_seen_insert(&seen, "k0") == 0);  // still remembered
}

static void test_format_event(void) {
  char out[512];
  const char *callers[] = {"Network", "CFNetwork", "MyApp"};
  int n = eg_format_event(out, sizeof out, "MyApp", 4242, "connect", "blocked", "93.184.216.34:443", callers, 3);
  CHECK(n > 0);
  CHECK(strcmp(out, "eas-egress-guard\tMyApp\t4242\tconnect\tblocked\t93.184.216.34:443\tNetwork,CFNetwork,MyApp\n") == 0);

  const char *tabbed[] = {"a\tb"};
  n = eg_format_event(out, sizeof out, "we\nird\tname", 1, "sendto", "logged", "1.2.3.4:53", tabbed, 1);
  CHECK(n > 0);
  CHECK(strcmp(out, "eas-egress-guard\twe ird name\t1\tsendto\tlogged\t1.2.3.4:53\ta b\n") == 0);

  n = eg_format_event(out, sizeof out, "NoCallers", 7, "connectx", "blocked", "[::2]:80", NULL, 0);
  CHECK(n > 0 && strcmp(out, "eas-egress-guard\tNoCallers\t7\tconnectx\tblocked\t[::2]:80\t\n") == 0);

  CHECK(eg_format_event(out, 16, "MyApp", 4242, "connect", "blocked", "93.184.216.34:443", callers, 3) == -1);
}

int main(void) {
  test_classify(); test_mode(); test_format_peer(); test_seen(); test_format_event();
  if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
  printf("egress-guard policy tests: all passed\n");
  return 0;
}
