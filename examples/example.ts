import { TrieRouter } from "../src/router.ts";

const r = new TrieRouter();
// r.pushMiddleware("/", () => console.log("global"))
// r.pushMiddleware("/user/*", () => console.log("hello"))
r.add("GET", "/user/*/ok", () => "ok");
const match = r.optimisedSearch("GET","/user/a/b/c/ok")
console.log(match)

r.add('GET',"/name/*", () => '')
const m2 = r.optimisedSearch('GET', '/name/pradeep/okdj')
console.log(m2)

r.add('GET', '/addr/*',() => '')
const m3 = r.optimisedSearch('GET', '/addr/ckhdjhjs/pradeep')
console.log(m3)

// const inComingpath="/hello/124ljsadls/loud/corss/dimmm"
// const matchedHandler = r.find("GET", inComingpath);
// console.log(matchedHandler); // { id: '123' }
