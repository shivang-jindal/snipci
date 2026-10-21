# Non-zero exit without an expectation

```javascript
console.error("kaboom");
process.exit(2);
```

# Wrong expected exit code

```js snipci="run expect-exit=1"
process.exit(0);
```
