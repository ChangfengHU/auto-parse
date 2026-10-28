# RUNTIME-006: XHS analysis QR login recovery

User reported /analysis/xhs cannot view data and QR polling repeatedly returns code=-1/success=false. Source uses independent Python pure-HTTP QR flow and repeats setInterval after errors. Investigate actual first-party browser flow, preserve profiles and other jobs, and verify data access separately from QR generation. No public publication is authorized.

## Final implementation
Replace the analysis page’s independent pure-HTTP QR helper with first-party browser QR observation, server-held opaque sessions, bounded serial client polling and explicit cancellation. Native non-guest identity plus domain session evidence is required. Cookies no longer traverse the QR UI or credential-bearing subprocess arguments, and the QR image is displayed directly without a third-party generator. Existing stored-cookie preview is masked.
Add explicit “reuse logged-in browser” selection/action for the two local instances. The read-only native identity is verified in an owned tab under the shared activity lock; only the selected domain session is synchronized server-side. No browser restart, account substitution or captcha solving.

## Real acceptance
Official browser QR generation and four waiting polls passed, with loaded image/no client Cookie and cancellation cleanup. User reported manual browser login; browser2 verified a non-guest native identity and synchronized successfully. The existing CLI-backed analysis validity and feed both succeeded. The new UI button was actually clicked in a canary and rendered37 notes; production restart then preserved valid login and read38 feed items at its observation time.
Source tests cover guest/foreign identity rejection, private cookie handling, cancellation/unknown handle, no overlapping polling, terminal/error stop, explicit browser selection and session cleanup.11/11 pass; independent TypeScript and production build pass. Focused lint has0 errors and6 preexisting-style warnings (image elements/unused disable). No publication or other content mutation.
Two separate build directories were used so production artifacts were never overwritten. Idle publication/dispatcher checks and both activity locks preceded each AutoParse-only restart. Previous builds remain available. Canary processes and task tabs were stopped/closed, not the logged-in browsers.

Final combined regression54/54 passes. The five unrelated dirty-file hashes match the initial snapshot. Only task files are committed and pushed on a public fix branch atop the existing public plugin branch; unrelated private runtime ancestors are not published.
