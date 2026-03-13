We are going to extend tick so it has some planning capabilities.

# TICK UPDATES

## New requirements:

- tick init will be interactive and ask for setting ticketing system only, planning only or both (1,2,3)
- ticketing system changes:
  - \_ISSUES renamed to \_TICKETS
  - now any ticket can be WORKSTREAM type or JOB type. A WORKSTREAM can contain multiple JOBs

- the planning module will add 2 extra tick folders:
  - \_PLAN -> Contains high level documents (010_PRD.md) and folders for features (010_feature) which can inlcude requirements (010_feature.REQ.md) and plans (020_feature.PLAN.md). Everything in PRD is for planning purposes
  - \_DOCS -> for documentation, post implementation. We musst keep documentation up to date.

## Tick/ticketing updated commands:

- modify new/update so they support JOB/WORKSTREAM
- modify init so it is interavtive and creates the new folder structure
- modify list to show JOB/WORKSTREAM and dependencies

## Tick/planning new commands:

- Under src/tick/template we will create simple templates for:
  - Requirement docs
  - Planning docs
  - Documentation docs

### New commands for automatically, from templates:

- Create a requirements doc
- Create a plan doc
- Create a documentation doc

## Tickets

### New pipeline

1. Create PRD high level DOC - PERSON
2. Create feature REQ - PERSON
3. Create feature PLAN - AGENT
4. Create feature master tasks tickets - AGENT
5. Create sub-tasks tickets - AGENT
6. Work on tickets - AGENT
7. Update documentation - AGENT

# TICK-REPORT UPDATES

- We should be able to select a single WORKSTREAM, so the WORKSTREAM and its JOBS will be visible.

# VERY IMPORTANT:

Update README.md, so the agent is able to follow the pipeline and produce the documents/tickets required with the right naming and formatting.

Add extra README.md files where you think it is appropriated so the agent can follow through the instructions. Interlink those files and provide an index of them at the top of the hierarchy so the agents know what to read depending on what they aare doing.
