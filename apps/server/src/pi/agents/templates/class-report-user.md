## Topic: {{title}}

{{statement}}

## Roster: {{students.length}} students in the class

{{#each students}}{{id}}{{#unless @last}}, {{/unless}}{{/each}}

## The whole class's conversations

{{#each students}}
### {{id}}

{{transcript}}

{{/each}}
