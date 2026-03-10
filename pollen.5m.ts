#!/Users/fischer/.bun/bin/bun # Replace with your Bun path

interface FirestoreString {
  stringValue: string;
}

interface FirestoreBoolean {
  booleanValue: boolean;
}

interface FirestoreInteger {
  integerValue: string;
}

interface FirestoreMap<T> {
  mapValue: { fields: T };
}

interface PollenDocument {
  fields: {
    [id: string]: FirestoreMap<{
      date: FirestoreString;
      data: FirestoreMap<{
        [id: string]: FirestoreMap<{
          level: FirestoreInteger;
          inSeason: FirestoreBoolean;
          predictions: FirestoreMap<{
            [id: string]: FirestoreMap<{
              prediction: FirestoreString;
              isML: FirestoreBoolean;
            }>;
          }>;
        }>;
      }>;
    }>;
  };
}

interface AllergensDocument {
  fields: {
    allergens: FirestoreMap<{
      [id: string]: FirestoreMap<{
        name: FirestoreString;
        latin: FirestoreString | { nullValue: null };
      }>;
    }>;
  };
}

interface ActiveAllergen {
  id: string;
  name: string;
  latin: string;
  level: number;
  inSeason: boolean;
  predictions: {
    [id: string]: FirestoreMap<{
      prediction: FirestoreString;
      isML: FirestoreBoolean;
    }>;
  };
}

interface AllergenInformation {
  name: string;
  latin: string;
}

const cities: { [city: string]: string } = {
  København: "48",
  Viborg: "49",
};

const selectedCity = "København";

const pollenLevels: { [id: string]: [number, number, number, number] } = {
  "1": [0, 10, 50, 200],
  "2": [0, 5, 15, 40],
  "4": [0, 10, 50, 80],
  "7": [0, 30, 100, 550],
  "28": [0, 10, 50, 150],
  "31": [0, 10, 50, 60],
  "44": [0, 20, 100, 500],
  "45": [0, 2000, 6000, 7000],
};

const predictionLabels: { [id: string]: string } = {
  "1": "Lavt",
  "2": "Moderat",
  "3": "Højt",
};

const fetchWithTimeout = async (url: string, ms = 2000): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const levelColor = (id: string, level: number): string => {
  const intervals = pollenLevels[id];
  if (!intervals || level < 0) return "#DDDDDD";
  if (level < intervals[1]) return "#72B743";
  if (level < intervals[2]) return "#FED05D";
  return "#C01448";
};

const predictionColor = (pred: string): string => {
  if (pred === "1") return "#72B743";
  if (pred === "2") return "#FED05D";
  if (pred === "3") return "#C01448";
  return "#DDDDDD";
};

const fetchData = async (): Promise<[PollenDocument, AllergensDocument]> => {
  const [pollenResponse, allergensResponse] = await Promise.all([
    fetchWithTimeout(
      "https://www.astma-allergi.dk/umbraco/api/pollenapi/getpollenfeed",
    ),
    fetchWithTimeout(
      "https://www.astma-allergi.dk/umbraco/api/pollenapi/getallergens",
    ),
  ]);
  const pollen: PollenDocument = JSON.parse(
    JSON.parse(await pollenResponse.text()),
  );
  const allergens: AllergensDocument = JSON.parse(
    JSON.parse(await allergensResponse.text()),
  );
  return [pollen, allergens];
};

const buildAllergenInformation = (
  allergens: AllergensDocument,
): { [id: string]: AllergenInformation } =>
  Object.entries(allergens.fields.allergens.mapValue.fields).reduce(
    (acc, [id, val]) => {
      const field = val.mapValue.fields;
      acc[id] = {
        name: field.name.stringValue,
        latin: "stringValue" in field.latin ? field.latin.stringValue : "",
      };
      return acc;
    },
    {} as { [id: string]: AllergenInformation },
  );

const buildAllergens = (
  pollen: PollenDocument,
  information: { [id: string]: AllergenInformation },
): [ActiveAllergen[], string] => {
  const feedId = cities[selectedCity];
  const feedDate = pollen.fields[feedId].mapValue.fields.date.stringValue;
  const feed = pollen.fields[feedId].mapValue.fields.data.mapValue.fields;

  const active: ActiveAllergen[] = Object.entries(feed)
    .map(([id, value]) => {
      const f = value.mapValue.fields;
      return {
        id,
        name: information[id]?.name ?? id,
        latin: information[id]?.latin ?? "",
        level: parseInt(f.level.integerValue),
        inSeason: f.inSeason.booleanValue,
        predictions: f.predictions.mapValue.fields,
      };
    })
    .filter((a) => a.inSeason)
    .sort((a, b) => b.level - a.level);

  return [active, feedDate];
};

const sort = (active: ActiveAllergen[]): string[] => {
  const parse = (d: string): number => {
    const [dd, mm, yy] = d.split("-");
    return new Date(`${yy}-${mm}-${dd}`).getTime();
  };

  return [
    ...active.reduce((dates, a) => {
      Object.keys(a.predictions).forEach((date) => dates.add(date));
      return dates;
    }, new Set<string>()),
  ].sort((a, b) => parse(a) - parse(b));
};

const renderTitle = (active: ActiveAllergen[]): void => {
  if (active.length < 1) {
    console.log("Ingen pollen");
  } else {
    const parts = active.map((a) => `${a.name}: ${a.level}`).join(" ");
    console.log(parts);
  }
};

const renderMeasurements = (
  active: ActiveAllergen[],
  feedDate: string,
): void => {
  console.log(`${selectedCity} — ${feedDate} | color=#888888`);
  for (const a of active) {
    console.log(`${a.name}: ${a.level} | color=${levelColor(a.id, a.level)}`);
  }
};

const renderPredictions = (active: ActiveAllergen[], dates: string[]): void => {
  for (const date of dates) {
    const hasAny = active.some((a) => {
      const pred = a.predictions[date]?.mapValue.fields.prediction.stringValue;
      return pred !== undefined && pred !== "";
    });
    if (!hasAny) continue;

    console.log("---");
    console.log(`${selectedCity} — ${date} | color=#888888`);

    for (const a of active) {
      const entry = a.predictions[date]?.mapValue.fields;
      if (!entry) continue;

      const pred = entry.prediction.stringValue;
      if (!pred) continue;

      console.log(
        `${a.name}: ${predictionLabels[pred] ?? pred} | color=${predictionColor(pred)}`,
      );
    }
  }
};

const render = async (): Promise<void> => {
  const [pollen, allergens] = await fetchData();
  const allergenInfo = buildAllergenInformation(allergens);
  const [active, feedDate] = buildAllergens(pollen, allergenInfo);

  renderTitle(active);
  console.log("---");

  if (active.length === 0) {
    console.log("Ingen allergener | color=#888888");
    return;
  }

  renderMeasurements(active, feedDate);
  renderPredictions(active, sort(active));
};

render().catch((error: Error) => {
  console.log("⚠️");
  console.log("---");
  console.log(`Fejl: ${error.message} | color=#e74c3c`);
  console.log("Opdatér | refresh=true");
});
