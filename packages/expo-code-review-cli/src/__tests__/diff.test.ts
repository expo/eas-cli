import { test, expect } from 'bun:test';

import { parseUnifiedDiff } from '../core/diff.js';

test('parses a normal text diff: path, status, patch, not binary', () => {
  const diff = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;`;
  const [entry] = parseUnifiedDiff(diff);
  expect(entry!.path).toBe('src/a.ts');
  expect(entry!.status).toBe('M');
  expect(entry!.binary).toBe(false);
  expect(entry!.patch).toContain('+const y = 2;');
});

test('flags a binary-diff marker (the binary blind-spot regression)', () => {
  const diff = `diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000000..05ecf33bf8
Binary files /dev/null and b/assets/logo.png differ`;
  const [entry] = parseUnifiedDiff(diff);
  expect(entry!.path).toBe('assets/logo.png');
  expect(entry!.binary).toBe(true);
  expect(entry!.status).toBe('A');
});

test('derives added / deleted status', () => {
  const added = parseUnifiedDiff(
    `diff --git a/n.ts b/n.ts\nnew file mode 100644\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1 @@\n+x`
  )[0];
  expect(added!.status).toBe('A');
  const deleted = parseUnifiedDiff(
    `diff --git a/d.ts b/d.ts\ndeleted file mode 100644\n--- a/d.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x`
  )[0];
  expect(deleted!.status).toBe('D');
});

test('splits multiple files in order', () => {
  const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-a
+b
diff --git a/c.ts b/c.ts
--- a/c.ts
+++ b/c.ts
@@ -1 +1 @@
-c
+d`;
  expect(parseUnifiedDiff(diff).map(e => e.path)).toEqual(['a.ts', 'c.ts']);
});
