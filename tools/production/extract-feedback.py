"""Extract only the authorized user review and accepted plan; never copy tool output or credentials."""
import hashlib, json, pathlib, re, sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
EXPECTED="e66b5383ad6aa6a56500e1ea9710e01da9a4ffc4d9949e9494e47bfa727856bf"
if len(sys.argv)!=2: raise SystemExit("Pass the session JSONL containing the supplied feedback and accepted plan")
feedback=None; plan=None
for line in pathlib.Path(sys.argv[1]).open(encoding="utf-8"):
    try: event=json.loads(line)
    except json.JSONDecodeError: continue
    payload=event.get("payload",{})
    text="\n".join(part.get("text","") for part in payload.get("content",[]) if isinstance(part,dict))
    if payload.get("role")=="user" and hashlib.sha256(text.encode()).hexdigest()==EXPECTED: feedback=text
    if payload.get("role")=="assistant" and text.startswith("<proposed_plan>\n# IntentGuard: remediation, dual deployments, and mainnet beta"):
        plan=text.removeprefix("<proposed_plan>\n").removesuffix("\n</proposed_plan>")
if feedback is None or plan is None: raise SystemExit("Authorized original feedback or accepted plan not found; refusing a reconstructed archive")
def write(path,text):
    dest=ROOT/path; dest.parent.mkdir(parents=True,exist_ok=True); dest.write_text(text,encoding="utf-8")
    print(path)
write("docs/reviews/2026-10-26-original-feedback.md",feedback)
write("docs/production/REMEDIATION-PLAN.md",plan+"\n")
lines=feedback.splitlines()
sections=[{"line":i+1,"heading":line} for i,line in enumerate(lines) if re.match(r"^#{1,4} ",line)]
write("docs/reviews/2026-10-26-provenance.json",json.dumps({"version":1,"origin":"Original user-supplied review payload, extracted verbatim from the session record","sha256":EXPECTED,"utf8Bytes":len(feedback.encode()),"characters":len(feedback),"sections":sections},indent=2)+"\n")
owners={"1.1":["R01","R02"],"1.2":["R06","R07"],"1.3":["R18"],"1.4":["R11"],"2.1":["R08","R09","R10"],"2.2":["R12","R13","R14","R15","R16","R17"],"3.1":["R19","R20"],"3.2":["R21","R22","R23","R24","R25"],"4.1":["R03","R04","R05","R26","R27"]}
entries=[]
for match in re.finditer(r"^\| (R\d\d) \| (P\d) \| (.*?) \| (.*?) \|$",plan,re.M):
    fid,priority,title,acceptance=match.groups()
    owner=next(k for k,v in owners.items() if fid in v)
    entries.append({"id":fid,"priority":priority,"title":title,"acceptance":acceptance,"ownerLeaf":owner,"observingGate":"leaf-"+owner+":"+fid,"status":"OPEN","sourceReferences":[],"evidence":[],"fixCommits":[],"retestCommits":[]})
if len(entries)!=27: raise SystemExit("Accepted plan must contain exactly R01 through R27")
write("docs/production/findings.json",json.dumps({"version":1,"contractRevision":1,"baselineCommit":"63ecc771b3313419f6df7f483e1b2964024570a6","originalFeedbackSha256":EXPECTED,"status":"IMPLEMENTING","decisions":{"testnetPreserved":True,"mainnetPaymentChainId":196,"reviewEnvironment":"testnet","mainnetDatabase":"intentguard_mainnet","executor":"github-actions","costPolicy":"quote-before-spending","usdt0Route":"xlayer-only","cctpDestinationChainIds":[8453,42161,10,1,137,43114,130,59144,480,999]},"findings":entries},indent=2)+"\n")
print("FEEDBACK_ARCHIVE_CREATED")
