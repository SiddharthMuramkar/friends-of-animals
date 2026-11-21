// The channels a message can go out on. Email and SMS leave the platform
// through their ports; in-app is the user's inbox, inside the platform.
//
// Pure, and loaded by the schema file for the `message_channel` enum: no
// imports, no "server-only".

export const MESSAGE_CHANNELS = ["email", "sms", "in_app"] as const;

export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
