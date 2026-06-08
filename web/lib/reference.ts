// Reference data for the filter controls.

export const US_STATES: { code: string; name: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"],
  ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
].map(([code, name]) => ({ code, name }));

// NAICS-aligned business-code prefixes used by the dataset's `business_code` filter.
export const INDUSTRIES: { value: string; label: string }[] = [
  { value: "", label: "Any industry" },
  { value: "51", label: "Information / Tech (51)" },
  { value: "54", label: "Professional, Scientific & Technical (54)" },
  { value: "62", label: "Health Care (62)" },
  { value: "52", label: "Finance & Insurance (52)" },
  { value: "31", label: "Manufacturing (31)" },
  { value: "32", label: "Manufacturing (32)" },
  { value: "33", label: "Manufacturing (33)" },
  { value: "44", label: "Retail (44)" },
  { value: "23", label: "Construction (23)" },
];

export const FUNDING_OPTIONS: { value: string; label: string }[] = [
  { value: "self-insured,partial", label: "Addressable (self-insured + partial)" },
  { value: "self-insured", label: "Self-insured only" },
  { value: "partial", label: "Partial only" },
  { value: "fully-insured", label: "Fully insured" },
  { value: "self-insured,partial,fully-insured,unknown", label: "All funding types" },
];

export const FUNDING_LABELS: Record<string, string> = {
  "self-insured": "Self-insured",
  partial: "Partial",
  "fully-insured": "Fully insured",
  unknown: "Unknown",
};
