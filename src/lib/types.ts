export type GeometryType = 'rectangle' | 'polygon' | 'brush' | 'whole-wall' | 'quad';
export type FillType = 'solid-color' | 'mural-image';
export type FitMode = 'contain' | 'cover' | 'stretch' | 'tile';
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-burn' | 'color-dodge' | 'hard-light' | 'soft-light';
export type ToolType = 'select' | 'rectangle' | 'polygon' | 'brush' | 'whole-wall' | 'pan' | 'magic-wand' | 'quad';
export type EditorMode = 'color' | 'mural';
export type FeedbackStatus = 'none' | 'liked' | 'disliked';

export interface Point {
  x: number;
  y: number;
}

export interface RectangleGeometry {
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PolygonGeometry {
  type: 'polygon';
  points: Point[];
}

export interface BrushGeometry {
  type: 'brush';
  points: Point[];
  strokeWidth: number;
}

export interface WholeWallGeometry {
  type: 'whole-wall';
}

export interface QuadGeometry {
  type: 'quad';
  corners: [Point, Point, Point, Point]; // TL, TR, BR, BL — normalized 0-1
}

export type RegionGeometry = RectangleGeometry | PolygonGeometry | BrushGeometry | WholeWallGeometry | QuadGeometry;

export interface SolidColorFill {
  type: 'solid-color';
  color: string;
}

export interface MuralImageFill {
  type: 'mural-image';
  muralId: string;
  fitMode: FitMode;
  offsetX: number;
  offsetY: number;
  scale: number;
  rotation: number;
}

export type RegionFill = SolidColorFill | MuralImageFill;

export interface Region {
  id: string;
  name: string;
  geometry: RegionGeometry;
  fill: RegionFill;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  locked: boolean;
  order: number;
}

export interface MockupFeedback {
  status: FeedbackStatus;
  comment: string;
  updatedAt: string;
}

export interface Mockup {
  id: string;
  name: string;
  regions: Region[];
  mode: EditorMode;
  feedback: MockupFeedback;
  createdAt: string;
  updatedAt: string;
}

export interface WallTransform {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  rotation: number;
}

export interface Wall {
  id: string;
  name: string;
  roomId: string;
  originalFileName: string;
  width: number;
  height: number;
  order: number;
  transform: WallTransform;
  mockups: Mockup[];
  createdAt: string;
}

export interface Room {
  id: string;
  name: string;
  order: number;
}

export interface Mural {
  id: string;
  name: string;
  originalFileName: string;
  width: number;
  height: number;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  notes: string;
  rooms: Room[];
  walls: Wall[];
  murals: Mural[];
  createdAt: string;
  updatedAt: string;
}
