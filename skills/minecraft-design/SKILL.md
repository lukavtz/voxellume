---
name: minecraft-design
description: Use when a new mod idea or feature request must become an agreed scope with named behaviours and runnable acceptance checks.
---

# Minecraft design

Design ends when the behaviour is testable. There is no spec format and no schema:
a plan is a list of behaviours, each with the check that proves it.

## Procedure

1. Frame the request. Give every requested behaviour a stable name. Cover the gameplay
   loop, progression, balance, configuration, persistence, multiplayer, and any
   compatibility promise. Separate decisions you made from questions for the user.
2. Bind the target. Call `minecraft_target_info`. Record the pin id and whether it has
   a template. A pin without a template means the project is created by hand.
3. Split into slices. Each slice is one behaviour, the data it needs, and one check.
   Order slices so each one can be built and run on its own.
4. Write the check for each slice before the code exists: a JUnit test, a GameTest, or
   an artifact check through `minecraft_run`. A slice whose acceptance cannot be
   observed is not a slice yet.
5. Decide the asset needs. Route textures, models, and animation to
   `minecraft-assets`, Blockbench to `minecraft-blockbench`, and Blender QA to
   `minecraft-blender`.
6. Stop and ask when a behaviour decision changes scope, balance, or compatibility.
   Guessing there costs a rewrite.

## Rules

- No invented mechanics to fill a gap. An unanswered question stays a question.
- No acceptance criteria derived from the implementation you plan to write.
- Keep the plan short enough to hold in one page of slices.

## Output

Return the behaviour list, the pin decision, the ordered slices with their checks, the
asset needs, and the open questions.
