# Unknown directive (typo protection)

`expec=` is not a directive — this must be a hard error naming file:line
instead of silently skipping.

```js snipci="run expec=ok"
console.log("never runs");
```
