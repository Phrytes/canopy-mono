# Summarize-only smoke — a SET of 10 messages

summarize prompt v4, temperature 0, Ollama @ http://localhost:11434.
Ideal = 6 bullets (milk/bread ×3, washing machine ×2, rent ×2 merge; dishes, parcel, dentist singletons).

Input batch (with duplicates):

```
1. We're out of milk and bread.
2. Kan iemand melk en brood halen? We hebben niks meer.
3. The washing machine broke down again.
4. De wasmachine is alweer stuk, moet gemaakt worden.
5. Rent needs to be transferred before Friday.
6. Someone has to do the dishes tonight.
7. Reminder: the parcel should go to the neighbours, not to us.
8. Don't forget rent is due this week!
9. We really need to buy bread, ran out this morning.
10. Can someone book the dentist appointment for the kids?
```

## qwen2.5:7b-instruct — 55452ms

```
- Milk and bread need to be bought (out of stock).
- The washing machine broke down again; it needs fixing.
- Rent needs to be transferred before Friday (due this week).
- Dishes need to be done tonight.
- A parcel should go to the neighbors, not us.
- Book a dentist appointment for the kids.
```
