// A software passkey for Seam 1: an ES256 authenticator built from
// node:crypto that answers WebAuthn registration and authentication
// challenges the way a browser and platform authenticator do, so passkey
// use cases are tested with real signatures and no browser.
//
//   const key = new FakePasskey({ origin: "http://localhost:3000" });
//   const response = key.register(options);   // RegistrationResponseJSON
//   const assertion = key.authenticate(options);

import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest();

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

export class FakePasskey {
  readonly credentialId: Uint8Array;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  /** The page origin the browser reports; change it to act as another site. */
  origin: string;
  private signCount = 0;
  /** Whether the next answer claims user verification (PIN, biometrics). */
  userVerified = true;

  constructor({ origin }: { origin: string }) {
    this.origin = origin;
    this.credentialId = crypto.getRandomValues(new Uint8Array(32));
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  private flags(extra = 0): number {
    return (
      FLAG_USER_PRESENT | (this.userVerified ? FLAG_USER_VERIFIED : 0) | extra
    );
  }

  private clientData(type: string, challenge: string): Buffer {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: this.origin,
        crossOrigin: false,
      })
    );
  }

  /** The COSE_Key (RFC 9053) of this passkey's public key. */
  private coseKey(): Uint8Array {
    const jwk = this.publicKey.export({ format: "jwk" });
    return isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ])
    );
  }

  /** Answers navigator.credentials.create() with "none" attestation. */
  register(
    options: PublicKeyCredentialCreationOptionsJSON
  ): RegistrationResponseJSON {
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(options.rp.id ?? new URL(this.origin).hostname),
      Buffer.from([this.flags(FLAG_ATTESTED_CREDENTIAL)]),
      uint32(this.signCount),
      Buffer.alloc(16), // AAGUID: none
      idLength,
      this.credentialId,
      this.coseKey(),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, never>>([
        ["fmt", "none"],
        ["attStmt", new Map<string, never>()],
        ["authData", authData],
      ])
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(
          this.clientData("webauthn.create", options.challenge)
        ),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** Answers navigator.credentials.get(), signing with this passkey. */
  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON
  ): AuthenticationResponseJSON {
    this.signCount += 1;
    const authData = Buffer.concat([
      sha256(options.rpId ?? new URL(this.origin).hostname),
      Buffer.from([this.flags()]),
      uint32(this.signCount),
    ]);
    const clientData = this.clientData("webauthn.get", options.challenge);
    const signature = sign(
      "sha256",
      Buffer.concat([authData, sha256(clientData)]),
      this.privateKey
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
