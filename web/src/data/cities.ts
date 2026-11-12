/**
 * A short, hand-authored list of places used only as map labels for orientation.
 *
 * Deliberately not a dataset: no licence to track, and a sparse set keeps the field
 * readable. City rankings are a later phase.
 */

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** Larger places are labelled at lower zoom. */
  rank: 1 | 2;
}

export const PLACES: Place[] = [
  { name: "Delhi", lat: 28.61, lon: 77.21, rank: 1 },
  { name: "Mumbai", lat: 19.08, lon: 72.88, rank: 1 },
  { name: "Kolkata", lat: 22.57, lon: 88.36, rank: 1 },
  { name: "Chennai", lat: 13.08, lon: 80.27, rank: 1 },
  { name: "Bengaluru", lat: 12.97, lon: 77.59, rank: 1 },
  { name: "Hyderabad", lat: 17.39, lon: 78.49, rank: 1 },
  { name: "Ahmedabad", lat: 23.03, lon: 72.58, rank: 2 },
  { name: "Pune", lat: 18.52, lon: 73.86, rank: 2 },
  { name: "Jaipur", lat: 26.91, lon: 75.79, rank: 2 },
  { name: "Lucknow", lat: 26.85, lon: 80.95, rank: 2 },
  { name: "Bhopal", lat: 23.26, lon: 77.41, rank: 2 },
  { name: "Patna", lat: 25.59, lon: 85.14, rank: 2 },
  { name: "Guwahati", lat: 26.14, lon: 91.74, rank: 2 },
  { name: "Nagpur", lat: 21.15, lon: 79.09, rank: 2 },
  { name: "Kochi", lat: 9.93, lon: 76.27, rank: 2 },
  { name: "Visakhapatnam", lat: 17.69, lon: 83.22, rank: 2 },
  { name: "Srinagar", lat: 34.08, lon: 74.8, rank: 2 },
  { name: "Bhubaneswar", lat: 20.3, lon: 85.82, rank: 2 },
];
