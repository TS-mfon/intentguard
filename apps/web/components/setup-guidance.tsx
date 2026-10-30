export function SetupGuidance(){
 return <details className="form-details setup-guidance"><summary>How to write terms validators can agree on</summary><ul>
  <li>Put numerical amounts, expiry and the budget period in Money &amp; validity. Each card has one aggregate period budget. Use 86,400 seconds for a day and 604,800 for seven days.</li>
  <li>Describe purpose and evidence in the criteria. Avoid adding a second daily or weekly spending limit there; the numerical circuit cannot enforce two aggregate periods on one card.</li>
  <li>Use the merchant’s verified recipient address, not a placeholder such as 0x111…111. Enter an HTTPS origin such as https://merchant.example, without an invoice path or query.</li>
  <li>Invoices must identify the buyer vault, exact token, destination, recipient, amount and invoice ID. Keep exceptions consistent with prohibited purchases.</li>
  <li>Review the complete finalized policy before activation. Validator disagreement creates a failed proposal; it does not create a vault or authorize payment. Edit the original terms and submit a new draft.</li>
 </ul></details>;
}
