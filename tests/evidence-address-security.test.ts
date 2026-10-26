import {test} from "node:test";
import assert from "node:assert/strict";
import {publicIp} from "../apps/web/lib/evidence";
test("S03 reserved IPv6 addresses cannot bypass checks through expanded or zero-padded notation",()=>{
 for(const ip of ["2001:db8::1","2001:0db8:0000:0000:0000:0000:0000:0001","2001:0000:4136:e378:8000:63bf:3fff:fdd2","2001:0002::1","2001:0020::1","3fff:0000::1","::ffff:127.0.0.1"])assert.equal(publicIp(ip),false,ip);
 for(const ip of ["2606:4700:4700::1111","2606:4700:4700:0000:0000:0000:0000:1111","2001:4860:4860::8888","1.1.1.1"])assert.equal(publicIp(ip),true,ip);
});
