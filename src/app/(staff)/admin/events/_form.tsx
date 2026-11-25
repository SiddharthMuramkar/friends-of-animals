import { getTranslations } from "next-intl/server";
import { buttonStyles } from "@/components/site/button-link";
import { inputStyles } from "@/components/form/text-field";
import { instantToIstLocal } from "@/server/modules/competitions/domain/ist";
import type { EventRow } from "@/server/db/schema";
import { EVENT_KINDS } from "@/server/modules/events/domain/event-status";
import { EVENT_AUDIENCES } from "@/server/modules/events/domain/event-details";
import { create, update } from "./actions";

export async function EventForm({ event }: { event?: EventRow }) {
  const t = await getTranslations("events");
  const date = (value: Date | null | undefined) =>
    value ? instantToIstLocal(value) : "";
  const text = (
    name:
      | "title"
      | "summary"
      | "venueName"
      | "address"
      | "city"
      | "pinCode"
      | "onlineUrl",
    maxLength: number,
    required = false
  ) => (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="font-semibold text-ink" htmlFor={name}>
        {t(`fields.${name}`)}
      </label>
      <input
        className={inputStyles}
        id={name}
        name={name}
        maxLength={maxLength}
        required={required}
        defaultValue={event?.[name] ?? ""}
        type={name === "onlineUrl" ? "url" : "text"}
      />
    </div>
  );
  const time = (
    name:
      | "startsAt"
      | "endsAt"
      | "registrationOpensAt"
      | "registrationClosesAt",
    required = false
  ) => (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="font-semibold text-ink" htmlFor={name}>
        {t(`fields.${name}`)}
      </label>
      <input
        className={inputStyles}
        id={name}
        name={name}
        type="datetime-local"
        required={required}
        defaultValue={date(event?.[name])}
      />
    </div>
  );
  return (
    <form
      action={event ? update.bind(null, event.id) : create}
      className="mt-8 flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6"
    >
      <p className="text-ink-muted">{t("formHint")}</p>
      <div className="flex flex-col gap-1">
        <label className="font-semibold text-ink" htmlFor="kind">
          {t("fields.kind")}
        </label>
        <select
          id="kind"
          name="kind"
          className={inputStyles}
          defaultValue={event?.kind ?? "event"}
        >
          {EVENT_KINDS.map((k) => (
            <option value={k} key={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </select>
      </div>
      {text("title", 120, true)}
      {text("summary", 280, true)}
      <div className="flex flex-col gap-1">
        <label className="font-semibold text-ink" htmlFor="description">
          {t("fields.description")}
        </label>
        <textarea
          id="description"
          name="description"
          className={inputStyles + " min-h-36"}
          maxLength={20000}
          defaultValue={event?.description ?? ""}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {time("startsAt", true)}
        {time("endsAt", true)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text("venueName", 120)}
        {text("address", 300)}
        {text("city", 80)}
        {text("pinCode", 6)}
        {text("onlineUrl", 1000)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="capacity" className="font-semibold text-ink">
            {t("fields.capacity")}
          </label>
          <input
            id="capacity"
            className={inputStyles}
            name="capacity"
            type="number"
            min={1}
            max={100000}
            step={1}
            defaultValue={event?.capacity ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="audience" className="font-semibold text-ink">
            {t("fields.audience")}
          </label>
          <select
            id="audience"
            name="audience"
            className={inputStyles}
            defaultValue={event?.audience ?? "members"}
          >
            {EVENT_AUDIENCES.map((a) => (
              <option value={a} key={a}>
                {t(`audience.${a}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {time("registrationOpensAt")}
        {time("registrationClosesAt")}
      </div>
      <label className="flex min-h-11 items-center gap-3 font-semibold text-ink">
        <input
          type="checkbox"
          name="waitlistEnabled"
          defaultChecked={event?.waitlistEnabled ?? true}
          className="size-5 accent-primary"
        />
        {t("fields.waitlistEnabled")}
      </label>
      <div>
        <button type="submit" className={buttonStyles()}>
          {t(event ? "save" : "create")}
        </button>
      </div>
    </form>
  );
}
