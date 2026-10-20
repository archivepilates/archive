import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readNativeContractPage } from "./studiomate-native-contract-reader.mjs";

test("reader rejects malformed IDs before opening a page", async () => {
  let opens = 0;
  await assert.rejects(
    readNativeContractPage(
      {
        goto: async () => {
          opens++;
        },
      },
      "../../other",
    ),
  );
  assert.equal(opens, 0);
});
test("waits for populated DOM; reads only the exact contract and contains no writes", async () => {
  const id = "a".repeat(64);
  const calls = [];
  const page = {
    goto: async (url) => calls.push(["goto", url]),
    waitForFunction: async () => calls.push(["loaded"]),
    url: () =>
      `https://arcpilates.studiomate.kr/users/contract/detail?id=${id}`,
    evaluate: async () => {
      calls.push(["read"]);
      return {
        contractId: id,
        title: "Synthetic contract",
        memberPhone: "01012345678",
      };
    },
  };
  const result = await readNativeContractPage(page, id);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["goto", "loaded", "loaded", "read"],
  );
  assert.equal(result.contractId, id);
  assert.ok(Date.parse(result.observedAt));
});
test("login redirect, incomplete page and wrong ID fail closed", async () => {
  const id = "a".repeat(64);
  for (const variant of ["login", "empty", "wrong"]) {
    const page = {
      goto: async () => {},
      waitForFunction: async () => {},
      url: () =>
        variant === "login"
          ? "https://arcpilates.studiomate.kr/login"
          : `https://arcpilates.studiomate.kr/users/contract/detail?id=${id}`,
      evaluate: async () =>
        variant === "empty"
          ? {}
          : {
              contractId: "b".repeat(64),
              title: "Synthetic",
              memberPhone: "01012345678",
            },
    };
    await assert.rejects(readNativeContractPage(page, id));
  }
});

test("signature readiness waits for the center seal on unsigned contracts too", async t => {
  const id = "a".repeat(64), waits = [];
  await readNativeContractPage({
    goto: async () => {},
    waitForFunction: async predicate => { waits.push(predicate); },
    url: () => `https://arcpilates.studiomate.kr/users/contract/detail?id=${id}`,
    evaluate: async () => ({contractId:id,title:"Synthetic",memberPhone:"01000000000"}),
  }, id);
  const ready = ({status="요청대기",center=true,member=false,date=false,duplicate=false} = {}) => {
    const block = (label, loaded) => ({
      querySelector: () => ({textContent:label}),
      querySelectorAll: () => loaded === null ? [] : [{complete:loaded,naturalWidth:loaded?1:0,getAttribute:()=>"/synthetic.png"}],
    });
    const blocks = [block("[아카이브필라테스]",center),block("[서명자]",member)];
    if (duplicate) blocks.push(block("[아카이브필라테스]",true));
    const document = {
      querySelector: selector => selector === ".contract-status-tag"
        ? {textContent:status} : date ? {textContent:"2026-10-20"} : null,
      querySelectorAll: () => blocks,
    };
    return vm.runInNewContext(`(${waits[1].toString()})()`,{document});
  };
  for (const [name,options,expected] of [
    ["unsigned seal loading",{center:false},false],
    ["unsigned seal absent",{center:null},false],
    ["unsigned seal loaded without member signature",{},true],
    ["duplicate seal blocks",{duplicate:true},false],
    ["signed requires member image",{status:"서명완료",date:true},false],
    ["signed requires center image",{status:"서명완료",center:false,member:true,date:true},false],
    ["signed requires date",{status:"서명완료",member:true},false],
    ["signed complete",{status:"서명완료",member:true,date:true},true],
    ["draft does not invent a seal",{status:"임시저장",center:null},true],
  ]) await t.test(name, () => assert.equal(ready(options),expected));
});

test("signature image timeout is specific and never reads incomplete evidence", async () => {
  let waits=0,reads=0;
  const timeout = new Error("Sensitive remote path must not escape");
  timeout.name="TimeoutError";
  await assert.rejects(readNativeContractPage({
    goto:async()=>{},
    waitForFunction:async()=>{if(++waits===2)throw timeout;},
    evaluate:async()=>{reads++;},
  },"a".repeat(64)),error=>error.code==="native_contract_signature_images_unavailable"
    && !error.message.includes("Sensitive"));
  assert.equal(reads,0);
});
