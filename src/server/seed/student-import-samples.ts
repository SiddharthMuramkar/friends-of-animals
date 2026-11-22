// Student import files (#76) for the preview and for tests: the sample a
// coordinator can try on the preview, with good rows and one of each common
// mistake, and a clean 30-row file (#77c's journey reuses it). Fictional
// students, example.test emails and +91 90000 06xxx / 07xxx numbers.
//
// Every date of birth fits both the seeded open competition (NEIGH27: 5–17
// on 1 January 2027) and the registration tests' competition (6–13 on
// 1 June 2027). Loads under plain Node: no imports at all.

const CRLF = "\r\n";

/** The template's header row, as the coordinator downloads it. */
const HEADER =
  "student_ref,full_name,date_of_birth,grade,guardian_name,guardian_relationship,guardian_phone,guardian_email";

/** [first name, surname, guardian's first name, date of birth]. */
const CLEAN_STUDENTS: readonly (readonly [string, string, string, string])[] = [
  ["Aarohi", "Bhosale", "Sunita", "2015-01-05"],
  ["Arnav", "Chawla", "Deepak", "2015-03-12"],
  ["Avni", "Das", "Moumita", "2015-05-20"],
  ["Ayaan", "Fernandes", "Gloria", "2015-07-02"],
  ["Bhavya", "Ghosh", "Subrata", "2015-09-18"],
  ["Darsh", "Hegde", "Prakash", "2015-11-25"],
  ["Esha", "Jain", "Ritu", "2016-01-08"],
  ["Farhan", "Qureshi", "Nasreen", "2016-03-14"],
  ["Gauri", "Kale", "Mangesh", "2016-05-27"],
  ["Harsh", "Lal", "Pooja", "2016-07-09"],
  ["Ira", "Malhotra", "Anil", "2016-09-21"],
  ["Jai", "Naidu", "Lakshmi", "2016-11-30"],
  ["Kiara", "Oberoi", "Simran", "2017-01-16"],
  ["Laksh", "Pandey", "Manoj", "2017-03-03"],
  ["Mira", "Rawat", "Geeta", "2017-05-19"],
  ["Neel", "Saxena", "Rajiv", "2017-07-28"],
  ["Ojas", "Thakur", "Kamla", "2017-09-10"],
  ["Pari", "Upadhyay", "Alok", "2017-11-22"],
  ["Rudra", "Varma", "Shalini", "2018-01-04"],
  ["Siya", "Wadhwa", "Gurpreet", "2018-03-17"],
  ["Tanay", "Yadav", "Sarita", "2018-05-29"],
  ["Urvi", "Zaveri", "Hetal", "2018-08-06"],
  ["Veer", "Agarwal", "Nitin", "2018-10-13"],
  ["Wamika", "Bose", "Indrani", "2018-12-24"],
  ["Yash", "Chopra", "Monika", "2019-02-07"],
  ["Zara", "Dutta", "Arindam", "2019-04-15"],
  ["Atharv", "Goel", "Vandana", "2019-06-26"],
  ["Navya", "Iyengar", "Srinivas", "2019-09-01"],
  ["Kian", "Joshi", "Farah", "2020-01-11"],
  ["Riya", "Kohli", "Harpreet", "2020-05-23"],
];

const two = (n: number) => String(n).padStart(2, "0");

/**
 * 30 students, every row good: each a minor with a parent, a roll number
 * C-01 to C-30 and a guardian's phone and email.
 */
export const CLEAN_STUDENT_IMPORT_CSV_30: string =
  [
    HEADER,
    ...CLEAN_STUDENTS.map(
      ([first, surname, guardian, dateOfBirth], index) =>
        `C-${two(index + 1)},${first} ${surname},${dateOfBirth},Class 3,${guardian} ${surname},parent,+91 90000 060${two(index + 1)},${guardian.toLowerCase()}.${surname.toLowerCase()}@example.test`
    ),
  ].join(CRLF) + CRLF;

/**
 * The preview's sample, for the seeded registration (NEIGH27-I-5EED1):
 * rows 2–6 are good (Groups A, B and C, one date written day first), and
 * rows 7–11 are one each of the usual mistakes: a minor with no guardian's
 * phone, 31 February, a child too young for the competition, the same
 * child as row 3 written another way, and Aarav Kulkarni, whom the
 * registration seed already enrolled.
 */
export const SAMPLE_STUDENT_IMPORT_CSV: string =
  [
    HEADER,
    "S-101,Ishita Deshmukh,2018-02-10,Class 2,Meera Deshmukh,parent,+91 90000 07601,meera.deshmukh@example.test",
    "S-102,Vihaan Gupta,2016-09-03,Class 4,Rohit Gupta,parent,+91 90000 07602,",
    "S-103,Ananya Pillai,14/11/2013,Class 7,Suresh Pillai,legal guardian,90000 07603,",
    ",Reyansh Kapoor,2019-07-21,Class 1,Neha Kapoor,parent,+91 90000 07604,",
    ",Saanvi Reddy,2015-04-05,Class 5,Padma Reddy,parent,+91 90000 07605,",
    ",Myra Khan,2017-05-12,Class 3,Salma Khan,parent,,salma.khan@example.test",
    ",Advik Menon,31/02/2016,Class 4,Arun Menon,parent,+91 90000 07607,",
    ",Zoya Sheikh,2022-03-15,Nursery,Imran Sheikh,parent,+91 90000 07608,",
    ",vihaan  GUPTA,03/09/2016,Class 4,Rohit Gupta,parent,+91 90000 07602,",
    ",Aarav Kulkarni,2019-03-14,Class 2,Sneha Kulkarni,parent,+91 90000 05101,",
  ].join(CRLF) + CRLF;
