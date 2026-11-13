/**
 * Places used as map labels and as the units of the rankings.
 *
 * Hand-authored rather than imported: no licence to track, and a curated list keeps
 * the map readable and the rankings meaningful. Chosen for population and for spread
 * across India's rainfall regimes, so the board is not all one coast.
 *
 * `rank` 1 places are labelled on the map; rank 2 are labelled more quietly; rank 3
 * appear only in the rankings.
 */

export interface Place {
  name: string;
  state: string;
  lat: number;
  lon: number;
  rank: 1 | 2 | 3;
  /**
   * Which side of the dot the label sits on. Default "right".
   *
   * Labels are placed by hand rather than by a collision solver: there are only a
   * dozen on screen, they never move relative to each other, and a solver that runs
   * on every pan is a lot of machinery for a fixed problem. "left" is used where a
   * westward neighbour's label would otherwise run into this city's dot.
   */
  labelSide?: "left" | "right";
}

export const PLACES: Place[] = [
  { name: "Delhi", state: "Delhi", lat: 28.61, lon: 77.21, rank: 1 },
  { name: "Mumbai", state: "Maharashtra", lat: 19.08, lon: 72.88, rank: 1 },
  { name: "Kolkata", state: "West Bengal", lat: 22.57, lon: 88.36, rank: 1 },
  { name: "Chennai", state: "Tamil Nadu", lat: 13.08, lon: 80.27, rank: 1 },
  // Bengaluru sits ~2.7 deg west of Chennai at the same latitude, so a right-hand
  // label runs straight through Chennai's dot at the default zoom.
  { name: "Bengaluru", state: "Karnataka", lat: 12.97, lon: 77.59, rank: 1, labelSide: "left" },
  { name: "Hyderabad", state: "Telangana", lat: 17.39, lon: 78.49, rank: 1 },

  { name: "Ahmedabad", state: "Gujarat", lat: 23.03, lon: 72.58, rank: 2 },
  { name: "Pune", state: "Maharashtra", lat: 18.52, lon: 73.86, rank: 2 },
  { name: "Jaipur", state: "Rajasthan", lat: 26.91, lon: 75.79, rank: 2 },
  { name: "Lucknow", state: "Uttar Pradesh", lat: 26.85, lon: 80.95, rank: 2 },
  { name: "Bhopal", state: "Madhya Pradesh", lat: 23.26, lon: 77.41, rank: 2 },
  { name: "Patna", state: "Bihar", lat: 25.59, lon: 85.14, rank: 2 },
  { name: "Guwahati", state: "Assam", lat: 26.14, lon: 91.74, rank: 2 },
  { name: "Nagpur", state: "Maharashtra", lat: 21.15, lon: 79.09, rank: 2 },
  { name: "Kochi", state: "Kerala", lat: 9.93, lon: 76.27, rank: 2 },
  { name: "Visakhapatnam", state: "Andhra Pradesh", lat: 17.69, lon: 83.22, rank: 2 },
  { name: "Srinagar", state: "Jammu & Kashmir", lat: 34.08, lon: 74.8, rank: 2 },
  { name: "Bhubaneswar", state: "Odisha", lat: 20.3, lon: 85.82, rank: 2 },

  { name: "Surat", state: "Gujarat", lat: 21.17, lon: 72.83, rank: 3 },
  { name: "Kanpur", state: "Uttar Pradesh", lat: 26.45, lon: 80.33, rank: 3 },
  { name: "Indore", state: "Madhya Pradesh", lat: 22.72, lon: 75.86, rank: 3 },
  { name: "Coimbatore", state: "Tamil Nadu", lat: 11.02, lon: 76.96, rank: 3 },
  { name: "Madurai", state: "Tamil Nadu", lat: 9.93, lon: 78.12, rank: 3 },
  { name: "Tiruchirappalli", state: "Tamil Nadu", lat: 10.79, lon: 78.7, rank: 3 },
  { name: "Thiruvananthapuram", state: "Kerala", lat: 8.52, lon: 76.94, rank: 3 },
  { name: "Kozhikode", state: "Kerala", lat: 11.26, lon: 75.78, rank: 3 },
  { name: "Mangaluru", state: "Karnataka", lat: 12.91, lon: 74.86, rank: 3 },
  { name: "Goa (Panaji)", state: "Goa", lat: 15.49, lon: 73.83, rank: 3 },
  { name: "Vijayawada", state: "Andhra Pradesh", lat: 16.51, lon: 80.65, rank: 3 },
  { name: "Puducherry", state: "Puducherry", lat: 11.94, lon: 79.83, rank: 3 },
  { name: "Nellore", state: "Andhra Pradesh", lat: 14.44, lon: 79.99, rank: 3 },
  { name: "Raipur", state: "Chhattisgarh", lat: 21.25, lon: 81.63, rank: 3 },
  { name: "Ranchi", state: "Jharkhand", lat: 23.34, lon: 85.31, rank: 3 },
  { name: "Varanasi", state: "Uttar Pradesh", lat: 25.32, lon: 82.97, rank: 3 },
  { name: "Amritsar", state: "Punjab", lat: 31.63, lon: 74.87, rank: 3 },
  { name: "Chandigarh", state: "Chandigarh", lat: 30.73, lon: 76.78, rank: 3 },
  { name: "Dehradun", state: "Uttarakhand", lat: 30.32, lon: 78.03, rank: 3 },
  { name: "Shillong", state: "Meghalaya", lat: 25.58, lon: 91.89, rank: 3 },
  { name: "Imphal", state: "Manipur", lat: 24.82, lon: 93.94, rank: 3 },
  { name: "Agartala", state: "Tripura", lat: 23.83, lon: 91.28, rank: 3 },
  { name: "Siliguri", state: "West Bengal", lat: 26.73, lon: 88.4, rank: 3 },
  { name: "Jodhpur", state: "Rajasthan", lat: 26.24, lon: 73.02, rank: 3 },
  { name: "Leh", state: "Ladakh", lat: 34.15, lon: 77.58, rank: 3 },
  { name: "Port Blair", state: "Andaman & Nicobar", lat: 11.62, lon: 92.73, rank: 3 },
];

/** Only these are drawn on the map; the rest would crowd it. */
export const LABELLED_PLACES = PLACES.filter((p) => p.rank <= 2);
