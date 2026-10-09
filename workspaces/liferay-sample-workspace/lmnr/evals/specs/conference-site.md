# Conference Site

## Purpose

We run an annual tech conference. We need a public site that shows the events happening and lets people sign up for individual events. An event manager reviews every signup before it is confirmed.

This document states what we need, not how to build it. Use the standard Liferay approach for each requirement.

## Users

- As a **visitor**, I want to browse upcoming events and sign up for one without an account, so I can reserve my place
- As an **event manager**, I want to approve or reject each signup, so I control who attends
- As a **site editor**, I want to rearrange and reuse page sections without a developer, so I can update the site as the conference evolves

## Details

| Item | Value |
| --- | --- |
| Conference name | Annual Tech Conference |
| Contact email | events@example.com |
| Main color | Deep navy |
| Accent color | Amber |
| Headings | Bold, heavy typeface |

### Events

Each event is one talk at the conference. People sign up for individual talks.

| Name | Description | Starts | Ends | Location | Capacity |
| --- | --- | --- | --- | --- | --- |
| Opening Keynote: The Next Decade of Software | Where software is heading and what it means for the teams that build it. | 2027-03-16 09:00 | 2027-03-16 10:00 | Main Hall | 300 |
| Shipping Faster With AI Coding Agents | How teams use AI agents to plan, build, and review code without losing control of quality. | 2027-03-16 11:00 | 2027-03-16 12:00 | Room 2 | 120 |
| Workshop: Securing Your Cloud Applications | A hands-on session to find and fix the most common security gaps in cloud apps. Bring a laptop. | 2027-03-17 13:30 | 2027-03-17 16:30 | Workshop Lab | 30 |

## Requirements

### 1. Event and Signup Information

- Each event has a name, description, start and end date and time, location, and capacity
- Each signup has the person's name, email, company, and dietary requirement
- Dietary requirement is picked from a fixed list: None, Vegetarian, Vegan, Gluten Free, Halal, Kosher, Other
- Every signup belongs to exactly one event; an event can have many signups
- Every signup has a status: Pending, Approved, or Rejected
- The site starts with the events listed in Details
- Administrators can see the current list of signups in the admin area

**Done when:** events and signups appear in the admin area, with at least one event and one signup saved.

### 2. Pages

- **Home:** opens with an eye-catching introduction to the conference, then shows the upcoming events
- **Events:** lists every event with its date, location, and places left (capacity minus signups that are not rejected)
- **Sign Up:** a form asking for all signup information, where the person picks the event
- **Thank You:** shown after a successful signup
- All pages are reachable from the site menu
- Page sections are reusable building blocks that editors can rearrange or place on other pages

**Done when:** a guest can open every page from the menu, and an editor can move a Home page section without code.

### 3. Brand

- The site has its own look, not the platform's default
- Every page uses the colors and heading style from Details
- Every page shows the same header with the conference name and menu
- Every page shows the same footer with the contact details
- New pages pick up the brand, header, and footer automatically

**Done when:** every page shows the brand, header, and footer, and a newly created page does too without extra work.

### 4. Signup Flow

- A visitor can submit the Sign Up form without logging in
- A submission is saved against the chosen event with status Pending
- After submitting, the visitor lands on the Thank You page
- Every signup enters the platform's approval workflow; the administrator approves or rejects it from their task list
- Approving sets the status to Approved; rejecting sets it to Rejected

**Done when:** a guest submission lands on Thank You, appears as Pending under the chosen event, and becomes Approved after the administrator approves it.

## Out of Scope

- Sending email of any kind; we will connect our mailing tool later
- Visitor accounts or login
- Blocking signups once an event is full