import {test} from "node:test";
import assert from "node:assert/strict";
import {MemoryStore} from "../apps/web/lib/store";
import {assertSigningLease} from "../apps/web/lib/signing-lease";
test("expired, replaced or missing worker leases cannot broadcast after long RPC waits",async()=>{
 const store=new MemoryStore(),now=Date.now();await store.create("requests",{_id:"job",leaseToken:"owner",leaseUntil:now+60000});await store.create("locks",{_id:"worker",leaseUntil:now+60000});
 await assertSigningLease(store,"requests","job","owner");
 for(const change of [{leaseToken:"replacement"},{leaseUntil:now-1}]){await store.patch("requests","job",{leaseToken:"owner",leaseUntil:now+60000,...change});await assert.rejects(assertSigningLease(store,"requests","job","owner"));}
 await store.patch("requests","job",{leaseToken:"owner",leaseUntil:now+60000});await store.patch("locks","worker",{leaseUntil:now-1});await assert.rejects(assertSigningLease(store,"requests","job","owner"));
});
