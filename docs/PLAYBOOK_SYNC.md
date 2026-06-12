# Playbook Sync Checklist

The Playbook page (/playbook) is a living document that must stay
in sync with the actual CRM configuration. Any time the following
changes are made, update src/pages/Playbook.jsx accordingly.

## Triggers — update Playbook when any of these change:

### Data model changes
- [ ] New tier added or renamed
- [ ] Deal stages added, removed, or renamed (INST_STAGES or INDIVIDUAL_STAGES)
- [ ] Lead stages added, removed, or renamed
- [ ] New object type added (e.g. new table that affects workflow)
- [ ] Object relationships change (e.g. new junction table)

### Process changes
- [ ] Stage entry/exit criteria updated
- [ ] New required fields added to any stage
- [ ] KYC/compliance requirements change
- [ ] Conversion flow updated (Individual → Pro → Enterprise)
- [ ] New scoring criteria added that affects stage movement

### UI changes
- [ ] New form fields on Account, Contact, Deal, or Lead forms
- [ ] New actions added to any detail page
- [ ] New pipeline added

## How to update the Playbook

1. Open src/pages/Playbook.jsx
2. Find the relevant STAGE_DETAILS or FLOW_NODES constant
3. Update the affected stage's content:
   - what: description of what happens at this stage
   - actions: what the user should do
   - fields: which form fields to complete
   - moveWhen: criteria for advancing to next stage
4. If a stage was added or removed, update the stages array
   and add/remove the corresponding detail entry
5. Update the "Last updated" date at the top of the page
6. Test the diagram renders correctly at /playbook

## Stage details location in code

Enterprise/Pro stages: ENT_STAGES in Playbook.jsx
Individual stages: IND_STAGES in Playbook.jsx
Flow nodes: EnterpriseFlow, ProFlow, IndividualFlow in Playbook.jsx

## Last updated
2026-06-12 — Initial version matching v0.1 schema
