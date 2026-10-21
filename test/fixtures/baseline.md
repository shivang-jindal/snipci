# Known failure for baseline testing

This snippet always fails; the baseline marks it as known so it is
reported but does not fail CI.

```js snipci="run expect=green"
console.log("still broken");
```
