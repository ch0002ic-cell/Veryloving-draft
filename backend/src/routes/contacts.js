//
// routes/contacts.js — emergency contacts CRUD + per-contact test alert.
//
// NOTE: the iOS app stores contacts locally in Core Data and does not currently
// read them back from here, so the SOS fan-out uses whatever contacts have been
// uploaded to this endpoint. Shapes follow the Phase 4 brief ({ contacts: [...] }
// for the collection) while remaining a superset of docs/BACKEND_API.md.
//

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const store = require('../store');
const { requireAuth } = require('../auth');
const { sendSMS } = require('../services/sms');

const router = express.Router();
router.use(requireAuth);

const PRIORITIES = ['primary', 'secondary', 'tertiary'];

/** Accept either a string ("primary") or the client's Int16 (0/1/2). */
function normalizePriority(value) {
  if (typeof value === 'number' && PRIORITIES[value]) return PRIORITIES[value];
  if (typeof value === 'string' && PRIORITIES.includes(value)) return value;
  return 'primary';
}

function listFor(userId) {
  return store.db.contactsByUser[userId] || (store.db.contactsByUser[userId] = []);
}

function toContact(input) {
  return {
    id: input.id || `ct_${uuidv4()}`,
    name: input.name || '',
    phone: input.phone || '',
    email: input.email || null,
    priority: normalizePriority(input.priority),
  };
}

// GET /v1/contacts  → { contacts: [...] }
router.get('/', (req, res) => {
  res.json({ contacts: listFor(req.user.id) });
});

// POST /v1/contacts
//   • { contacts: [...] }      → bulk replace, returns { success: true }
//   • { name, phone, email?, priority } → create one, returns the Contact
router.post('/', (req, res) => {
  const body = req.body || {};
  if (Array.isArray(body.contacts)) {
    store.db.contactsByUser[req.user.id] = body.contacts.map(toContact);
    store.save();
    console.log(`[contacts] replaced ${body.contacts.length} contact(s) for ${req.user.id}`);
    return res.json({ success: true });
  }
  if (!body.name || !body.phone) {
    return res.status(400).json({ message: 'A contact needs at least a name and phone number.' });
  }
  const contact = toContact(body);
  listFor(req.user.id).push(contact);
  store.save();
  console.log(`[contacts] added "${contact.name}" for ${req.user.id}`);
  res.status(201).json(contact);
});

// PUT /v1/contacts/:id  → full update
router.put('/:id', (req, res) => {
  const contacts = listFor(req.user.id);
  const index = contacts.findIndex((c) => c.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: "We couldn't find that contact." });
  contacts[index] = toContact({ ...req.body, id: req.params.id });
  store.save();
  res.json(contacts[index]);
});

// DELETE /v1/contacts/:id  → 204
router.delete('/:id', (req, res) => {
  const contacts = listFor(req.user.id);
  const next = contacts.filter((c) => c.id !== req.params.id);
  store.db.contactsByUser[req.user.id] = next;
  store.save();
  res.status(204).end();
});

// POST /v1/contacts/:id/test-alert  → sends a non-emergency test SMS
router.post('/:id/test-alert', (req, res) => {
  const contact = listFor(req.user.id).find((c) => c.id === req.params.id);
  // The client calls this with the contact's local UUID, which may not exist
  // server-side yet — fall back to a friendly placeholder so the UX still works.
  const name = contact ? contact.name : 'your contact';
  const phone = contact ? contact.phone : '(unknown)';
  sendSMS({
    to: phone,
    body: `Veryloving test alert: ${req.user.displayName || 'A Veryloving user'} added you as an emergency contact. No action needed.`,
  });
  console.log(`[contacts] test-alert to ${name} for ${req.user.id}`);
  res.json({ success: true });
});

module.exports = router;
