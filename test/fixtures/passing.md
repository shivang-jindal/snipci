# Passing fixture

Zero-config: a plain fence with a known adapter runs by default.

```javascript
console.log("hello snipci");
```

Exact expectation (bare value):

```js snipci="run expect=hello"
console.log("hello");
```

Multi-word expectation (quoted value inside the info string):

```js snipci="run expect='hello world'"
console.log("hello world");
```

Regex expectation:

```js snipci="run expect-regex='^count: [0-9]+$'"
console.log(`count: 42`);
```

Expected non-zero exit:

```js snipci="run expect-exit=3"
process.exit(3);
```

Expected error (exit 1 + stderr):

```js snipci="expect-error"
console.error("boom: not found");
process.exit(1);
```

Inline directives on the first line:

```javascript
// snipci: expect "inline-ok"
console.log("inline-ok");
```

Inline skip with reason:

```javascript
// snipci: skip reason=illustrative-only
this is not valid JavaScript (((
```

Title attribute doubles as the id anchor:

```js title=anchored expect=anchored
console.log("anchored");
```
