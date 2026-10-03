# GoHighLevel setup: "Call rings your phone first" (433)

Your decision (Oct 3, option 1): when someone taps **Call** in the Hub, GoHighLevel assigns that contact to the person
who tapped, rings that person's phone, and when they answer and press a key, connects them to the contact from the
office number. The call is logged in GoHighLevel. The assignment changes with each call.

The Hub does its part (assign + tag). The ringing is done by one GoHighLevel workflow, which you build once. Claude
can't build it for you, because GoHighLevel's workflow builder can't be driven from here.

## 1. Build the workflow (about 5 minutes)

In the **Caring Companions** sub-account:

1. **Automation**, then **Workflows**, then **Create Workflow**, then **Start from scratch**.
2. Rename it (top left) to exactly: **Hub call bridge**
   (the Hub checks for this name, so it can tell you when it's missing or not published).
3. **Add New Trigger**: choose **Contact Tag**. Add the filter **Tag Added** = `hub-call-bridge`. Save the trigger.
4. Click **+** under the trigger and add the action **Call**:
   - Whisper message: `Caring Companions call to {{contact.first_name}} {{contact.last_name}}. Press any key to connect.`
   - Turn **ON** "Connect call after keypress" (so a voicemail can't swallow the call).
   - Timeout: about **25 seconds**.
   - Save the action.
5. Click **+** under the Call action and add **Remove Contact Tag**, tag `hub-call-bridge`. Save.
6. Open the workflow's **Settings** tab and turn **Allow re-entry ON** (otherwise each person can only ever be called
   once through it). Save.
7. Switch the workflow from Draft to **Publish**, and **Save**.

## 2. Check every office person's phone in GoHighLevel

The Call action rings the phone number on the **assigned user's** GoHighLevel profile.

**Settings**, then **My Staff**: open each office person (you, Krystal, every coordinator) and check their own cell
number is in their user's **Phone** field. No phone there means nothing rings for them.

## 3. Check it from the Hub

**Hub, Settings, Calls: your phone rings first**, then **Check the setup**. It shows:

- whether the **Hub call bridge** workflow is published (or missing, or still a draft)
- whether GoHighLevel lets the Hub list its users (then everyone links automatically by their email)
- each office person: linked, or not linked

If someone shows **not linked**, their Hub email isn't the email on their GoHighLevel user. Either change one of the
emails to match, or type a line in the box on that card: `email = GoHighLevel user id` (ask Claude for the id).

## 4. Try one call

Tap **Call** on any client or caregiver in the Hub. You should see "Ringing your phone now. Answer, then press any key
to connect to ...". Your phone rings from the office number; answer, hear the whisper, press any key.

**If your phone doesn't ring:**

- Settings, Calls, **Check the setup**: is the workflow published? Are you linked?
- In GoHighLevel, open that contact: if the tag `hub-call-bridge` is **still on** it a minute later, the workflow
  didn't run (not published, the trigger filter isn't exactly `hub-call-bridge`, or re-entry is off).
- If the tag is gone but nothing rang: check your phone number on your GoHighLevel user (step 2).
- Meanwhile every Call panel still has **Open in browser** and **Call from my cell**.

## Good to know

- Only a person's tap starts a call. Nothing automatic can (the server refuses it), one call per person per 30 seconds.
- The Hub never creates a GoHighLevel contact. It changes two things on the contact you call: **Assigned to** (you) and
  the `hub-call-bridge` tag, which the workflow removes again. Each call is written to the Hub's history (who, which
  contact, when, and who the contact was assigned to before).
- Because the contact's owner changes, check that no other GoHighLevel workflow starts on "Contact Changed" /
  "assigned user changed", and that GoHighLevel's "contact assigned to you" notifications don't bother anyone.
- Not in GoHighLevel, or two contacts share the number: the Hub says so and offers your cell. It never picks.
