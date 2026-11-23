# Define the entry status values up front

The first Entries migration defines every entry status used through FOA verification. PostgreSQL requires a new enum value to be committed before pending migration SQL can use it, so later judging and verification work can add transition rules without needing another split migration. The transition table enables each move as its workflow is built.
