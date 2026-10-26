import {test} from "node:test";
import assert from "node:assert/strict";
import {privateKeyToAccount} from "viem/accounts";
import type {Hex} from "viem";
import {validateTransactionJournal} from "../apps/web/lib/transaction-profile";
const account=privateKeyToAccount(("0x"+"11".repeat(32)) as Hex),to=("0x"+"22".repeat(20)) as Hex,data="0x12345678" as Hex;
const binding={paymentEnvironment:"mainnet",paymentChainId:196,gateway:account.address.toLowerCase()};
const expected={chainId:196,to,data,gateway:account.address,binding,requireBinding:true};
async function sign(changes:Record<string,unknown>={}){return account.signTransaction({chainId:196,type:"eip1559",nonce:0,to,data,value:0n,gas:100000n,maxFeePerGas:2n,maxPriorityFeePerGas:1n,...changes} as never);}
test("a valid journal recovers the exact signed intent and signer",async()=>{await validateTransactionJournal({raw:await sign(),binding},expected)});
test("cross-chain, altered target, calldata, value and signer cannot recover",async()=>{
 for(const changes of [{chainId:1952},{to:account.address},{data:"0xabcdef"},{value:1n}])await assert.rejects(validateTransactionJournal({raw:await sign(changes),binding},expected));
 await assert.rejects(validateTransactionJournal({raw:await sign(),binding},{...expected,gateway:to}));
});
test("copied or unbound mainnet journals fail before broadcast",async()=>{
 const raw=await sign();
 for(const altered of [undefined,{...binding,paymentEnvironment:"testnet"},{...binding,paymentChainId:1952},{...binding,gateway:to}])await assert.rejects(validateTransactionJournal({raw,binding:altered},expected));
 await validateTransactionJournal({raw},{...expected,requireBinding:false});
});
