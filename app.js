const API_BASE = "https://grillindex.cblabs.app/v1";
const MAP_CENTER = [31.55, 34.95];
const MAP_BOUNDS = [[29.2, 33.8], [33.5, 36.2]];
const CITY_REQUEST_LIMIT = 3;
const REQUEST_TIMEOUT_MS = 8000;

const CITIES = [
  { name: "Jerusalem", lat: 31.7683, lon: 35.2137 },
  { name: "Tel Aviv", lat: 32.0853, lon: 34.7818 },
  { name: "Haifa", lat: 32.794, lon: 34.9896 },
  { name: "Beersheba", lat: 31.2518, lon: 34.7913 },
  { name: "Ashdod", lat: 31.8044, lon: 34.6553 },
  { name: "Netanya", lat: 32.3215, lon: 34.8532 },
  { name: "Rishon LeZion", lat: 31.973, lon: 34.7925 },
  { name: "Petah Tikva", lat: 32.084, lon: 34.8878 },
  { name: "Holon", lat: 32.0158, lon: 34.7874 },
  { name: "Bnei Brak", lat: 32.0807, lon: 34.8338 },
  { name: "Ashkelon", lat: 31.6688, lon: 34.5743 },
  { name: "Rehovot", lat: 31.8948, lon: 34.8113 },
  { name: "Bat Yam", lat: 32.0238, lon: 34.7519 },
  { name: "Herzliya", lat: 32.1624, lon: 34.8447 },
  { name: "Eilat", lat: 29.5577, lon: 34.9519 }
];

const scoreMapElement = document.getElementById("scores-map");
const topMapElement = document.getElementById("top-map");
const findMapElement = document.getElementById("find-map");
const scoresStatus = document.getElementById("scores-status");
const topStatus = document.getElementById("top-status");
const searchStatus = document.getElementById("search-status");
const searchForm = document.getElementById("city-search");
const searchInput = document.getElementById("city-query");
const searchButton = document.getElementById("search-button");
const cityResults = document.getElementById("city-results");
const cityResult = document.getElementById("city-result");

let scoreMap;
let topMap;
let findMap;
let selectedMarker;
let searchSequence = 0;

function setStatus(element, message, state) {
  element.textContent = message;
  if (state) {
    element.dataset.state = state;
  } else {
    delete element.dataset.state;
  }
}

function makeMap(element) {
  return L.map(element, {
    scrollWheelZoom: false,
    zoomControl: true,
    keyboard: true
  }).setView(MAP_CENTER, 7);
}

function addBaseTiles(map, element) {
  const tileError = document.createElement("div");
  tileError.className = "map-tile-error";
  tileError.setAttribute("role", "status");
  tileError.setAttribute("aria-live", "polite");
  tileError.textContent = "Map tiles could not load. Check your connection and try again.";
  tileError.hidden = true;
  element.append(tileError);

  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 18,
    attribution: "Tiles &copy; Esri"
  }).addTo(map);
  map.on("tileerror", () => {
    tileError.hidden = false;
  });
}

function fitIsrael(map) {
  map.fitBounds(MAP_BOUNDS, { padding: [12, 12] });
}

function makeMapPopup(city, score) {
  const popup = document.createElement("div");
  const name = document.createElement("p");
  name.className = "popup-title";
  name.textContent = city.name;
  popup.append(name);

  const scoreLine = document.createElement("p");
  scoreLine.className = "popup-score";
  scoreLine.textContent = `Grill score: ${score.score}/100${score.grade ? ` · ${score.grade}` : ""}`;
  popup.append(scoreLine);

  if (score.verdict) {
    const verdict = document.createElement("p");
    verdict.className = "popup-detail";
    verdict.textContent = score.verdict;
    popup.append(verdict);
  }

  const conditions = formatConditions(score.conditions);
  if (conditions.length) {
    const weather = document.createElement("p");
    weather.className = "popup-detail";
    weather.textContent = conditions.join(" · ");
    popup.append(weather);
  }

  const windowText = formatWindow(score.best_window);
  const windowLine = document.createElement("p");
  windowLine.className = "popup-detail";
  windowLine.textContent = windowText ? `Best today: ${windowText}` : "No suitable grilling window available today.";
  popup.append(windowLine);
  return popup;
}

function formatConditions(conditions) {
  if (!conditions || typeof conditions !== "object") return [];
  const details = [];
  if (Number.isFinite(conditions.temp_f)) {
    const celsius = Math.round(((conditions.temp_f - 32) * 5) / 9);
    details.push(`${celsius}°C`);
  }
  if (Number.isFinite(conditions.wind_mph)) {
    details.push(`${Math.round(conditions.wind_mph * 1.60934)} km/h wind`);
  }
  if (Number.isFinite(conditions.precip_prob)) {
    details.push(`${Math.round(conditions.precip_prob)}% rain chance`);
  }
  if (typeof conditions.sunset === "string" && conditions.sunset) {
    details.push(`Sunset ${conditions.sunset}`);
  }
  return details;
}

function formatWindow(window) {
  if (!window || typeof window.start !== "string" || typeof window.end !== "string") return "";
  return `${window.start}–${window.end}`;
}

function validateScore(data) {
  if (!data || !Number.isFinite(data.score) || data.score < 0 || data.score > 100) {
    throw new Error("The API returned an invalid score.");
  }
  return {
    score: data.score,
    grade: typeof data.grade === "string" ? data.grade : "",
    verdict: typeof data.verdict === "string" ? data.verdict : "",
    conditions: data.conditions && typeof data.conditions === "object" ? data.conditions : null,
    best_window: data.best_window && typeof data.best_window === "object" ? data.best_window : null
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("The Grill Index API request timed out. Check your connection and try again.");
      }
      throw new Error("Could not reach the Grill Index API. Check your connection and try again.");
    }

    if (!response.ok) {
      throw new Error(`The Grill Index API returned an error (${response.status}).`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error("The Grill Index API returned an unreadable response.");
    }
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function getScore(city) {
  const params = new URLSearchParams({
    lat: String(city.lat),
    lon: String(city.lon),
    style: "charcoal"
  });
  const data = await fetchJson(`${API_BASE}/index/grill?${params}`);
  return validateScore(data);
}

function addScoreMarker(map, city, score) {
  const marker = L.marker([city.lat, city.lon], {
    title: `${city.name}: grilling score ${score.score} out of 100`,
    alt: `${city.name} grilling score ${score.score}`
  });
  marker.setIcon(L.divIcon({
    className: "",
    html: `<span class="score-marker">${score.score}</span>`,
    iconSize: [35, 35],
    iconAnchor: [17, 17]
  }));
  marker.bindPopup(makeMapPopup(city, score));
  marker.addTo(map);
}

function addTopMarker(city, score, rank) {
  const marker = L.marker([city.lat, city.lon], {
    title: `Rank ${rank}: ${city.name}, grilling score ${score.score} out of 100`,
    alt: `Rank ${rank}: ${city.name}, score ${score.score}`
  });
  marker.setIcon(L.divIcon({
    className: "",
    html: `<span class="top-marker"><span>${rank}</span></span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  }));
  marker.bindTooltip(`${city.name} · ${score.score}`, {
    permanent: true,
    direction: "top",
    offset: [0, -16],
    className: "map-label"
  });
  marker.bindPopup(makeMapPopup(city, score));
  marker.addTo(topMap);
}

async function loadCityScores() {
  if (typeof L === "undefined") {
    setStatus(scoresStatus, "The map library did not load. Check your connection and refresh.", "error");
    setStatus(topStatus, "The map library did not load. Check your connection and refresh.", "error");
    return;
  }

  const scores = new Map();
  const failures = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < CITIES.length) {
      const city = CITIES[nextIndex];
      nextIndex += 1;
      try {
        scores.set(city.name, await getScore(city));
      } catch (error) {
        failures.push({ name: city.name, message: error.message });
        console.error(`Could not load grilling score for ${city.name}.`, error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CITY_REQUEST_LIMIT, CITIES.length) }, () => worker())
  );

  for (const city of CITIES) {
    const score = scores.get(city.name);
    if (score) addScoreMarker(scoreMap, city, score);
  }

  const scoredCities = CITIES
    .filter((city) => scores.has(city.name))
    .map((city) => ({ city, score: scores.get(city.name) }))
    .sort((a, b) => b.score.score - a.score.score);

  if (failures.length === CITIES.length) {
    setStatus(scoresStatus, "Live scores are unavailable for all selected cities. Try again later.", "error");
    setStatus(topStatus, "There are no live city scores to rank right now.", "error");
    return;
  }

  const completeness = failures.length
    ? `${scores.size} of ${CITIES.length} cities loaded; unavailable: ${failures.map((item) => item.name).join(", ")}.`
    : `Live scores loaded for all ${CITIES.length} selected cities.`;
  setStatus(scoresStatus, completeness, failures.length ? "error" : "success");

  const cutoffScore = scoredCities[Math.min(2, scoredCities.length - 1)].score.score;
  const leaders = scoredCities.filter((item) => item.score.score >= cutoffScore);
  leaders.forEach((item, index) => addTopMarker(item.city, item.score, index + 1));

  if (failures.length) {
    const leaderCount = leaders.length;
    setStatus(
      topStatus,
      `${leaderCount > 3 ? `Top three, including ${leaderCount - 3} cutoff tie${leaderCount - 3 === 1 ? "" : "s"}` : "Highest available scores"} from ${scores.size} of ${CITIES.length} cities; ranking is incomplete.`,
      "error"
    );
  } else {
    setStatus(
      topStatus,
      leaders.length > 3
        ? `${leaders.length} cities shown because the third-place score is tied.`
        : "Top scores are based on the live results above.",
      "success"
    );
  }

  fitIsrael(scoreMap);
  fitIsrael(topMap);
}

function closeCityResults() {
  cityResults.replaceChildren();
  cityResults.hidden = true;
  searchInput.setAttribute("aria-expanded", "false");
}

function displayCityResults(results) {
  cityResults.replaceChildren();
  for (const city of results) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");

    const name = document.createElement("span");
    name.className = "result-name";
    name.textContent = city.name;
    const region = document.createElement("span");
    region.className = "result-region";
    region.textContent = [city.region, "Israel"].filter(Boolean).join(", ");
    button.append(name, region);
    button.addEventListener("click", () => selectCity(city));
    item.append(button);
    cityResults.append(item);
  }
  cityResults.hidden = results.length === 0;
  searchInput.setAttribute("aria-expanded", String(results.length > 0));
}

function appendCondition(container, label) {
  const chip = document.createElement("span");
  chip.className = "condition-chip";
  chip.textContent = label;
  container.append(chip);
}

function renderCityResult(city, score) {
  cityResult.replaceChildren();
  cityResult.hidden = false;

  const topLine = document.createElement("div");
  topLine.className = "result-topline";
  const name = document.createElement("h3");
  name.className = "result-city";
  name.textContent = city.name;
  topLine.append(name);
  if (score.grade) {
    const grade = document.createElement("span");
    grade.className = "result-grade";
    grade.textContent = score.grade;
    topLine.append(grade);
  }
  cityResult.append(topLine);

  const scoreLine = document.createElement("p");
  scoreLine.className = "result-score";
  const numericScore = document.createElement("strong");
  numericScore.textContent = String(score.score);
  const scoreOutOf = document.createElement("span");
  scoreOutOf.textContent = "/ 100";
  scoreLine.append(numericScore, scoreOutOf);
  cityResult.append(scoreLine);

  if (score.verdict) {
    const verdict = document.createElement("p");
    verdict.className = "result-verdict";
    verdict.textContent = score.verdict;
    cityResult.append(verdict);
  }

  const conditions = formatConditions(score.conditions);
  if (conditions.length) {
    const conditionRow = document.createElement("div");
    conditionRow.className = "condition-row";
    conditions.forEach((condition) => appendCondition(conditionRow, condition));
    cityResult.append(conditionRow);
  } else {
    const unavailable = document.createElement("p");
    unavailable.className = "result-verdict";
    unavailable.textContent = "Current weather details are unavailable.";
    cityResult.append(unavailable);
  }

  const windowRow = document.createElement("div");
  windowRow.className = "window-row";
  const windowText = formatWindow(score.best_window);
  if (windowText) {
    windowRow.append("Best grilling time today: ");
    const time = document.createElement("strong");
    time.textContent = windowText;
    windowRow.append(time);
  } else {
    windowRow.textContent = "No suitable grilling window is available today.";
  }
  cityResult.append(windowRow);
}

async function selectCity(city) {
  closeCityResults();
  cityResult.hidden = true;
  cityResult.replaceChildren();
  setStatus(searchStatus, `Loading live grilling conditions for ${city.name}…`);
  if (selectedMarker) {
    findMap.removeLayer(selectedMarker);
    selectedMarker = null;
  }

  findMap.setView([city.lat, city.lon], 11);
  const requestId = ++searchSequence;
  try {
    const score = await getScore(city);
    if (requestId !== searchSequence) return;
    renderCityResult(city, score);
    selectedMarker = L.marker([city.lat, city.lon], {
      title: `${city.name}: grilling score ${score.score} out of 100`,
      alt: `${city.name} grilling score ${score.score}`
    }).addTo(findMap);
    selectedMarker.bindPopup(makeMapPopup(city, score)).openPopup();
    setStatus(searchStatus, `Live conditions for ${city.name}.`, "success");
  } catch (error) {
    if (requestId !== searchSequence) return;
    setStatus(searchStatus, error.message, "error");
    console.error(`Could not load grilling conditions for ${city.name}.`, error);
  }
}

function validateGeocodeResult(result) {
  return result
    && result.country === "IL"
    && typeof result.name === "string"
    && Number.isFinite(result.lat)
    && Number.isFinite(result.lon);
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  const requestId = ++searchSequence;
  if (!query) {
    closeCityResults();
    cityResult.hidden = true;
    cityResult.replaceChildren();
    if (selectedMarker) {
      findMap?.removeLayer(selectedMarker);
      selectedMarker = null;
    }
    setStatus(searchStatus, "Enter an Israeli city name to search.", "error");
    searchInput.focus();
    return;
  }
  if (typeof L === "undefined") {
    setStatus(searchStatus, "The map library did not load. Check your connection and refresh.", "error");
    return;
  }

  searchButton.disabled = true;
  closeCityResults();
  cityResult.hidden = true;
  cityResult.replaceChildren();
  if (selectedMarker) {
    findMap.removeLayer(selectedMarker);
    selectedMarker = null;
  }
  setStatus(searchStatus, "Searching Israeli cities…");

  const normalizedQuery = query.replace(/,\s*Israel$/i, "").trim();
  try {
    const params = new URLSearchParams({ q: `${normalizedQuery}, Israel` });
    const data = await fetchJson(`${API_BASE}/geocode?${params}`);
    if (requestId !== searchSequence) return;
    const results = Array.isArray(data.results) ? data.results.filter(validateGeocodeResult) : [];
    if (!results.length) {
      setStatus(searchStatus, `No Israeli city found for “${query}”. Try another city name.`, "error");
      return;
    }
    displayCityResults(results);
    setStatus(searchStatus, `${results.length} Israeli match${results.length === 1 ? "" : "es"} found. Choose a city.`);
    cityResults.querySelector("button")?.focus();
  } catch (error) {
    if (requestId !== searchSequence) return;
    setStatus(searchStatus, error.message, "error");
    console.error("Could not search for an Israeli city.", error);
  } finally {
    searchButton.disabled = false;
  }
});

searchInput.addEventListener("input", () => {
  searchSequence += 1;
  closeCityResults();
  if (searchStatus.dataset.state) setStatus(searchStatus, "");
});

if (typeof L === "undefined") {
  setStatus(scoresStatus, "The map library did not load. Check your connection and refresh.", "error");
  setStatus(topStatus, "The map library did not load. Check your connection and refresh.", "error");
  setStatus(searchStatus, "The map library did not load. Check your connection and refresh.", "error");
} else {
  scoreMap = makeMap(scoreMapElement);
  topMap = makeMap(topMapElement);
  findMap = makeMap(findMapElement);
  addBaseTiles(scoreMap, scoreMapElement);
  addBaseTiles(topMap, topMapElement);
  addBaseTiles(findMap, findMapElement);
  fitIsrael(scoreMap);
  fitIsrael(topMap);
  fitIsrael(findMap);
  loadCityScores();
}
