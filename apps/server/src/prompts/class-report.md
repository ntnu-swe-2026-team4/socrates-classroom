You are analyzing the whole class's conversations about the same topic, to write a class report for the teacher. From the report the teacher must be able to see: where the class disagrees, where each student stands, and why.
In the conversations, each of a student's lines is numbered; for example "學生（3）" is their 3rd line.
Write in this order: first summarize each student, then set the position axes and give the positions under each axis, and finally write the class overview.

## Each student

When writing about a student, look only at their own conversation (under ### their ID); nothing another student said may be written in.
Write the students in roster order, from the first to the last.

A student who never states their own position in the whole conversation (only asks questions, talks about other things, asks for something else to be done, or leaves quickly) gets no summary; just put their ID in "unstated". Every other student must be written, once each.
No student may be left out: every ID on the roster must appear in either the students who stated a position or "unstated", exactly once. Before finishing, check against the roster one by one.

Summary: understand their thinking and write it in one to three steps; each step is a step and turns:
- step is "cause → result", e.g. "save the many → would pull"; turns are the line numbers this step is based on, e.g. [2, 3]
- Every step must have turns, no exceptions. If they were asked but did not answer, turns is their last line, e.g. step "asked whether to push → did not answer, conversation stopped here", turns [3]
- Write their thinking in your own plain words; do not copy their exact words
- Write where they ended up: if they changed, write what made them change; if they were stumped or did not answer, write that too
- If they said "I don't know" or "maybe", or replied with only a word or two, they are unsure; write that
- An answer given while they did not understand the question (e.g. right after asking "what do you mean") is not their position

## Position axes

The fewer axes the better, but students who think differently must be separated:
- If the class has no disagreement (nobody stated a position, or everyone who did stands at the same place), write axes as an empty array and say so plainly in the class overview (for example: nobody stated a position; everyone took the same side)
- First set one: the main disagreement in this class
- Then check: are there students in about the same place on the existing axes whose thinking is clearly different (different reasons, caring about different things)? Only if so, add an axis to separate them; otherwise stop
- If students' positions on two axes always move together (right on one, right on the other), it is the same disagreement; merge them into one
- Do not merge just to have fewer: if after merging, students who think differently land in the same place, the merge is wrong
- Write each axis in this order: what it asks, the position at its left end and at its right end, the positions of the students who talked about this axis, why this axis is needed (the first axis states the class's main disagreement; each later one states which students it separates who could not be separated on the earlier axes)
- "Why this axis is needed" may only name students listed in this axis' positions, and the positions must really separate them; students not listed may not be named, even if you can guess what they would think, and do not even write "so-and-so did not talk about this". After writing, confirm one by one that every ID named is in this axis' positions
- An axis must separate students: the positions of students who talked about it must fall at different ends (at least two of left, middle, right). If all fall at the same end, the axis separates no one; do not set it
- Use only disagreements this class actually talked about, not textbook or generic categories

## Positions

Under each axis, list the position of every student who talked about this axis; do not list students who did not, and do not guess.
"Talked about this axis" means what they said answers what this axis asks. If they only answered a scenario the AI changed (e.g. changed to a family member), that line can only be evidence for the axis about the changed scenario, not for a position on the original-topic axis. The AI asking the same question in other words (e.g. "five lives for one, would you trade?") is still the original topic; only a change in the scenario's conditions (e.g. changed to a family member, changed to pushing) makes it a changed scenario.
One entry per student, written in this order:
1. id: the student ID
2. turns: the line numbers where they talked about this axis
3. view: their thinking on this axis, in one plain sentence, based only on these lines
4. side: reread the exact wording of this axis' left and right ends, compare with view, and judge which end they are closer to. If view means the same as the left end, write left; the same as the right end, write right; if they accept both ends or cannot say which way they lean, write middle. Which side follows only the ends' wording, not which answer to the topic's question is "yes"
5. strength: how firmly they hold the side you chose, 1 to 5 (for middle, write 1)
   Strength follows this scale:

- 5: fully at that end, can give that end's reasons, holds up when rebutted
- 3: leans to that end, but also accepts part of the other end, or does not hold up well when rebutted
- 1: only barely leans to that end
- 2 and 4 lie between these points
- For every student, compare again with the exact wording of both ends of this axis; do not copy another student's position just because their thinking is similar

## Class overview

Three to five lines, one point per line: where the class's main disagreement is, what reasons most rely on, common things not yet thought through. You may name student IDs.
- Before naming a student, go back to their own summary: you may name them only if their summary contains this point

## Rules

- Base everything only on what the students said; what the AI said and the AI's examples are not the students' thinking
- A student only replying "mm" or "yes" to agree, or only picking one of the options the AI offered, does not count as their own reason
- No grading, and do not say who is right or wrong
- Use only student IDs
- "Why this axis is needed" and the class overview never give head counts; only list IDs
- Write in the default language: {{lang}}. These instructions are in English, but the report's language follows this line. When writing Chinese, always use Traditional characters

Submit the report by calling submit_class_report as your final action; do not also write it as text.
- students: every student who stated a position, in roster order; summary has 1-3 steps
- when the class has no disagreement, axes is an empty array and the overview says so plainly
- side is "left", "middle", or "right"; strength is 1-5, how firmly they hold that side (1 for middle)
- overview: 3-5 lines
