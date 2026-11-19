import type { ArticleBody } from "../model";

// The misattributed Gandhi line is debunked without quoting it. Rukmini
// Devi's own 1954 words were not found, so none are quoted.
export const article = {
  blocks: [
    {
      type: "paragraph",
      text: [
        "There is a line about animals that is often shared with Mahatma Gandhi’s name on it: that you can judge a nation by the way it treats its animals. Gandhi never said it.",
        { fn: "f7" },
        " The true story behind that idea in India is better. It starts with a dancer who asked Parliament to protect animals, and a Prime Minister who agreed with her.",
      ],
    },
    { type: "heading", level: 2, text: "The quote Gandhi never said" },
    {
      type: "paragraph",
      text: [
        "In 2020 the journal ",
        { em: "Gandhi Marg" },
        " looked for the line and reported that Gandhi’s Collected Works “do not contain the quotation, or even anything vaguely similar”.",
        { fn: "f7" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "The earliest place anyone has found it pinned to Gandhi is a reader’s letter in ",
        { em: "The Gazette" },
        " of Montreal, in 1980, more than thirty years after his death.",
        { fn: "f8" },
        " The idea itself is older and German. In 1872 the writer David Friedrich Strauss wrote that “the manner in which a nation in the aggregate treats animals, is one chief measure of its real civilization”.",
        { fn: "f9" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "So the famous line is neither Indian nor Gandhi’s. But India had its own debate about compassion and civilisation, in Parliament, and it is on the record.",
      ],
    },
    { type: "heading", level: 2, text: "A dancer in the Rajya Sabha" },
    {
      type: "paragraph",
      text: [
        "Rukmini Devi Arundale was an artist first. On 6 January 1936 she founded a centre for the arts at Adyar, in what is now Chennai. It later became Kalakshetra, where Bharatanatyam, music and crafts are still taught.",
        { fn: "f10" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "In 1952 she became the first woman nominated to the Rajya Sabha, India’s upper house of Parliament, and she served there until 1962.",
        { fn: "f1" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "On 5 March 1954 she moved a Bill in the house: the Prevention of Cruelty to Animals Bill, 1953.",
        { fn: "f2" },
        " Her own speech that day has not yet been found in full, so we do not quote her. Lines shared online as hers are unverified, and we leave them out.",
      ],
    },
    { type: "heading", level: 2, text: "What Nehru said" },
    {
      type: "paragraph",
      text: [
        "Prime Minister Jawaharlal Nehru replied to what the record calls her “moving speech”.",
        { fn: "f2" },
        " He agreed with her:",
      ],
    },
    { type: "quote", quoteId: "Q10a" },
    {
      type: "paragraph",
      text: [
        "In the same reply he added that “compassion has to be effective compassion”: a feeling is not enough unless it actually reduces suffering.",
        { fn: "f2" },
        " Six years later, during the debate on the new law, another member, P. N. Sapru, read Nehru’s words back to the house.",
        { fn: "f3" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "The government promised a committee to study the problem, and the Bill was not pressed to a vote.",
        { fn: "f2" },
      ],
    },
    { type: "heading", level: 2, text: "From a Bill to a law" },
    {
      type: "paragraph",
      text: [
        "In 1959 Nehru wrote to an animal welfare conference that “through the labours especially of Shrimati Rukmani Devi Arundale”, the government had been “induced to prepare a comprehensive legislation for the prevention of cruelty to animals”.",
        { fn: "f4" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "That law is the Prevention of Cruelty to Animals Act, 1960. It received the President’s assent on 26 December 1960, and it is still in force.",
        { fn: "f5" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "Under the Act, the government formed the Animal Welfare Board of India on 19 March 1962. Rukmini Devi was its founding chair, and she led it until her death in February 1986, apart from four years.",
        { fn: "f6" },
      ],
    },
    { type: "heading", level: 2, text: "Why we tell this story" },
    {
      type: "paragraph",
      text: [
        "An artist helped write the rules that protect India’s animals. Friends of Animals runs art, writing, photography and film competitions for children because we think creativity and kindness belong together, and her life shows how close they can be.",
      ],
    },
    {
      type: "paragraph",
      text: [
        "It is also why we check every quote before we use it. A true story with its sources is worth more than a famous line that nobody said.",
      ],
    },
    {
      type: "callout",
      tone: "success",
      title: "What you can do this week",
      body: [
        [
          "Before you share a quote, look for where it first appeared. If nobody can name the book, speech or letter, don’t share it.",
        ],
        [
          "Mark the Animal Welfare Fortnight, held every year from 14 to 30 January, on your family calendar, and plan one kind act for animals for each week.",
          { fn: "f11" },
        ],
        [
          "Draw or write about one rule you think would make life kinder for animals near you, and why. Rukmini Devi started with an idea too.",
        ],
      ],
    },
  ],
  footnotes: [
    {
      id: "f1",
      text: "Rajya Sabha Secretariat, FAQ on Parliament, 2016",
      url: "https://cms.rajyasabha.nic.in/UploadedFiles/ElectronicPublications/FAQ.pdf",
    },
    {
      id: "f2",
      text: "Nehru Archive, “Prevention of Cruelty to Animals, 5 March 1954” (Selected Works of Jawaharlal Nehru, 2nd series, vol. 25, pp. 576–581)",
      url: "https://nehruarchive.in/documents/prevention-of-cruelty-to-animals-5-march-1954-v8ojg",
    },
    {
      id: "f3",
      text: "Rajya Sabha debates, 2 March 1960 (Internet Archive copy)",
      url: "https://web.archive.org/web/20251207001235/https://rsdebate.nic.in/bitstream/123456789/561341/1/PD_28_02031960_18_p2438_p2548_10.pdf",
    },
    {
      id: "f4",
      text: "Nehru Archive, “To All India Animal Welfare Conference, 3 August 1959”",
      url: "https://nehruarchive.in/documents/to-all-india-animal-welfare-conference-3-august-1959-vp8e1",
    },
    {
      id: "f5",
      text: "India Code, The Prevention of Cruelty to Animals Act, 1960 (No. 59 of 1960)",
      url: "https://www.indiacode.nic.in/bitstream/123456789/15397/1/cruelty_to_animals_act,_1960.pdf",
    },
    {
      id: "f6",
      text: "Animal Welfare Board of India, Annual Report 1999–2000",
      url: "https://www.awbi.gov.in/uploads/regulations/165607088919Annual%20Report%201999-2000.pdf",
    },
    {
      id: "f7",
      text: "Gandhi Marg 41(4), “If Gandhi Didn’t Say It, He Should Have”, Jan–Mar 2020",
      url: "https://www.mkgandhi.org/ebks/Gandhi-Marg-January-March2020.pdf",
    },
    {
      id: "f8",
      text: "Wikiquote, Mahatma Gandhi: Disputed",
      url: "https://en.wikiquote.org/wiki/Mahatma_Gandhi",
    },
    {
      id: "f9",
      text: "International Vegetarian Union, history page on Gandhi (citing D. F. Strauss, The Old Faith and the New, 1872)",
      url: "https://ivu.org/history/gandhi/index.html",
    },
    {
      id: "f10",
      text: "Kalakshetra Foundation, “History”",
      url: "https://kalakshetra.in/college/history/",
    },
    {
      id: "f11",
      text: "Press Information Bureau, Animal Welfare Fortnight, 9 Jan 2025",
      url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2091457",
    },
  ],
} satisfies ArticleBody;
