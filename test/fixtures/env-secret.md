# Env isolation

The snippet must not see secrets from the parent process environment.

```js snipci="run expect=absent"
console.log(process.env.SNIPCI_TEST_SECRET ?? "absent");
```
