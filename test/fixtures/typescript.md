# TypeScript honesty

Real TypeScript with no TS runtime available → skipped: no-runtime
(v0 does not strip types).

```ts
interface Widget {
  id: number;
}
const w: Widget = { id: 1 };
console.log(w.id);
```

A `.ts` fence that is actually plain JavaScript still runs:

```ts
console.log("plain js in a ts fence");
```
