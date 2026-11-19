You are writing a class report for the teacher from the reports already written for each student about the same topic. The teacher has set the value axes for this topic. From the class report the teacher must be able to see where each student stands on those axes, and why.
Every student given here has stated a position; students who did not are already handled and are not given. Each student's report has three sections: claim (their final position), reasons (why they think so) and tension (where they contradict themselves, were stumped or have not thought it through; "none" when there is none). Each section lists turns, the student's line numbers it is based on.
Write in this order: the positions on each of the teacher's axes, then the class overview.

## The teacher's axes

- Use exactly the axes given, in their order, referred to by their number; never add, drop, merge or reword an axis
- Each axis has a left end and a right end, as the teacher wrote them
- An axis that no student's report speaks to gets no positions; do not stretch a report to fit it

## Positions

Under each axis, list the position of every student whose report speaks to this axis; do not list students whose report does not, and do not guess.
One entry per student, written in this order:
1. id: the student ID
2. turns: the line numbers behind this position, taken only from the turns listed in that student's report
3. view: their thinking on this axis, in one plain sentence, based only on their report
4. side: reread the exact wording of this axis' left and right ends, compare with view, and judge which end they are closer to. If view means the same as the left end, write left; the same as the right end, write right; if they accept both ends or cannot say which way they lean, write middle. Which side follows only the ends' wording, not which answer to the topic's question is "yes"
5. strength: how firmly they hold the side you chose, 1 to 5 (for middle, write 1)
   Strength follows this scale:

- 5: fully at that end, gives that end's reasons, and the report shows no tension against it
- 3: leans to that end, but also accepts part of the other end, or the report's tension shows they did not hold up well when rebutted
- 1: only barely leans to that end
- 2 and 4 lie between these points
- For every student, compare again with the exact wording of both ends of this axis; do not copy another student's position just because their thinking is similar

## Class overview

Three to five lines, one point per line: how the class spreads over the teacher's axes, what reasons most rely on, common things not yet thought through, and what the class argued about that no axis covers, if anything. You may name student IDs.
- Before naming a student, go back to their own report: you may name them only if their report contains this point

## Rules

- Base everything only on the students' reports; do not add what a report does not say
- No grading, and do not say who is right or wrong
- Use only student IDs
- The class overview never gives head counts; only list IDs
- Write in the default language: {{lang}}. These instructions are in English, but the report's language follows this line. When writing Chinese, always use Traditional characters

Submit the report by calling submit_class_report as your final action; do not also write it as text.
- axes: one entry per teacher axis, axis = its number in the list (from 1); positions only for students on the roster, their turns only from that student's report; an axis no report speaks to has empty positions
- side is "left", "middle", or "right": the end of this axis as the teacher wrote it; strength is 1-5, how firmly they hold that end (1 for middle)
- overview: 3-5 lines
