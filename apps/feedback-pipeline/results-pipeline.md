# Full pipeline — clean (qwen2.5:7b-instruct) then summarize

prompt v3, temperature 0, Ollama @ http://localhost:11434.
Summarizers: qwen2.5:7b-instruct, mistral:7b-instruct


## Step 1+2 — cleaned messages (qwen2.5:7b-instruct)

| # | raw → cleaned |
|---|---------------|
| 1 | **raw:** We're out of milk and bread.<br>**cleaned:** We zijn uit melk en brood. |
| 2 | **raw:** Kan iemand melk en brood halen? We hebben niks meer.<br>**cleaned:** Kan iemand melk en brood halen? We hebben niets meer. |
| 3 | **raw:** The washing machine broke down again.<br>**cleaned:** De wasmachine is wéér kapot. |
| 4 | **raw:** De wasmachine is alweer stuk, moet gemaakt worden.<br>**cleaned:** De wasmachine is alweer stuk, het moet gemaakt worden. |
| 5 | **raw:** Rent needs to be transferred before Friday.<br>**cleaned:** Rent needs to be transferred before Friday. |
| 6 | **raw:** Someone has to do the dishes tonight.<br>**cleaned:** iemand moet vannacht de vaat doen. |
| 7 | **raw:** Reminder: the parcel should go to the neighbours, not to us.<br>**cleaned:** Reminder: the parcel should go to the neighbours, not to us. |
| 8 | **raw:** Don't forget rent is due this week!<br>**cleaned:** Don't forget rent is due this week! |
| 9 | **raw:** We really need to buy bread, ran out this morning.<br>**cleaned:** We really need to buy bread, ran out this morning. |
| 10 | **raw:** Can someone book the dentist appointment for the kids?<br>**cleaned:** Can someone book the dentist appointment for the kids? |

## Step 3 — summary (qwen2.5:7b-instruct) — 23613ms

```
- We are out of milk and bread; someone needs to get some before Friday.
- The washing machine is broken again; it needs fixing.
- Rent needs to be transferred before Friday; don't forget, it's due this week.
- Someone should do the dishes tonight.
- A parcel should go to the neighbors, not us.
- Can someone book a dentist appointment for the kids?
```

## Step 3 — summary (mistral:7b-instruct) — 39503ms

```
- Out of milk and bread.
- Need milk and bread; no more left at home.
- Washing machine is broken again.
- Washing machine is broken and needs repair.
- Rent needs to be transferred by Friday (Message 5).
- Someone should do the dishes tonight.
- Reminder: parcel should be delivered to neighbors, not us (Message 7).
- Rent is due this week (Messages 6 & 8).
- Need to buy bread urgently; ran out this morning (Message 9).
- Book dentist appointment for kids needed.
```
