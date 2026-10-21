# Timeout

The snippet sleeps past its 1 second budget; snipci kills the process tree
and reports an error (never a pass).

```js snipci="run timeout=1"
await new Promise((resolve) => setTimeout(resolve, 5000));
console.log("too late");
```
