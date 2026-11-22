// The accounts every preview and local database is seeded with. All use the
// reserved example.test domain, sign in by email code through the capture
// mailbox, and keep fixed ids so links and journeys can name them. Member 1
// also has a phone, so it signs in by SMS code too (#58); the number is in
// a block no real subscriber holds.
//
// Their roles come from the access seeder (./access.ts): the super admin is
// a global super admin, the first member holds several roles, the second is
// a staff admin and the third holds none.

export const SEED_ACCOUNTS = {
  superAdmin: {
    id: "01938a00-0000-7000-8000-000000000001",
    name: "Seed Super Admin",
    email: "super-admin@example.test",
  },
  members: [
    {
      id: "01938a00-0000-7000-8000-000000000101",
      name: "Asha Rao",
      email: "member1@example.test",
      phone: "+91 90000 00101",
    },
    {
      id: "01938a00-0000-7000-8000-000000000102",
      name: "Ravi Kumar",
      email: "member2@example.test",
    },
    {
      id: "01938a00-0000-7000-8000-000000000103",
      name: "Meera Iyer",
      email: "member3@example.test",
    },
  ],
} as const;

// Dedicated publishers keep the consent journeys from sharing a one-use
// staff code with the roles and second-factor journeys.
export const SEED_CONSENT_PUBLISHERS = {
  desktop: {
    name: "Consent Staff Admin",
    email: "consent-publisher-desktop@example.test",
    role: "staff_admin",
  },
  mobile: {
    name: "Consent Super Admin",
    email: "consent-publisher-mobile@example.test",
    role: "super_admin",
  },
} as const;
