// The form kit: the pieces every signed-in and sign-in form is built from.
// Labels and messages come in as props, from messages/en-IN like every other
// visible string.
//
// OutcomeNotice isn't listed here: pages import it from its own file, so it
// stays out of the kit's bytes on every page that uses the kit (/contact
// sits close to the JS budget).
export { FormAlert } from "./form-alert";
export { SelectField } from "./select-field";
export { SubmitButton } from "./submit-button";
export { TextAreaField } from "./text-area-field";
export { inputStyles, TextField } from "./text-field";
