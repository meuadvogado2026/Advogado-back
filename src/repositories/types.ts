import type {
  AdminBenefitCreate,
  AdminBenefitPatch,
  AdminImageUpload,
  AdminLawyerImageUpload,
  AdminPartnerLogoCreate,
  CityCreate,
  CityPatch,
  LawyerCreate,
  LawyerPatch,
  PrayerRequest,
  StateCreate,
  StatePatch
} from "../contracts/api.js";
import type { GeocodeConfidence, GeocodePrecision, GeocodeProviderName } from "../modules/geocoding/geocodingService.js";
import type { Role } from "../auth/types.js";

export type Profile = {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  blockedAt?: string | null;
  mustChangePassword?: boolean;
  accessInvitedAt?: string | null;
  firstLoginCompletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminUserRecord = {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  blockedAt?: string | null;
  mustChangePassword: boolean;
  accessInvitedAt?: string | null;
  firstLoginCompletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lawyerProfileId?: string | null;
  lawyerStatus?: LawyerRecord["status"] | null;
};

export type PageInput = {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
};

export type PageResult<T> = {
  items: T[];
  total: number;
};

export type LawyerVisualFields = {
  avatarUrl?: string | null;
  coverUrl?: string | null;
  miniBio?: string | null;
  fullBio?: string | null;
};

export type LegalSpecialty = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
};

export type LawyerRecord = LawyerCreate & {
  id: string;
  profileId: string;
  officeLat?: number | null;
  officeLng?: number | null;
  officeLocationPresent?: boolean;
  officeGeocodeProvider?: GeocodeProviderName | null;
  officeGeocodePrecision?: GeocodePrecision | null;
  officeGeocodeConfidence?: GeocodeConfidence | null;
  officeGeocodedAt?: string | null;
  officeLocationStatus?: "validated" | "needs_confirmation" | "pending";
  officeCity?: string | null;
  officeState?: string | null;
  serviceStateId?: string | null;
  serviceStateCode?: string | null;
  serviceCityName?: string | null;
  mustChangePassword?: boolean;
  accessInvitedAt?: string | null;
  firstLoginCompletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StateRecord = StateCreate & { id: string; createdAt: string; updatedAt: string };
export type CityRecord = {
  id: string;
  stateId: string;
  stateCode: string;
  name: string;
  active: boolean;
  center: LawyerCoordinates;
  createdAt: string;
  updatedAt: string;
};

export interface GeographyRepository {
  listStates(activeOnly?: boolean): Promise<StateRecord[]>;
  listStatesWithAvailableLawyers(): Promise<StateRecord[]>;
  getState(id: string): Promise<StateRecord | null>;
  createState(input: StateCreate): Promise<StateRecord>;
  updateState(id: string, patch: StatePatch): Promise<StateRecord | null>;
  deleteState(id: string): Promise<"deleted" | "linked" | "not_found">;
  listCities(stateId?: string, activeOnly?: boolean): Promise<CityRecord[]>;
  listCitiesWithAvailableLawyers(stateId: string): Promise<CityRecord[]>;
  getCity(id: string): Promise<CityRecord | null>;
  createCity(input: CityCreate): Promise<CityRecord>;
  updateCity(id: string, patch: CityPatch): Promise<CityRecord | null>;
  deleteCity(id: string): Promise<"deleted" | "linked" | "not_found">;
}

/** Coordenada geocodificada persistida no escritorio do advogado (office_location). */
export type LawyerCoordinates = { lat: number; lng: number };

export type LawyerOfficeAddress = {
  city: string;
  state: string;
};

export type LawyerOfficeLocation = {
  address?: LawyerOfficeAddress;
  coordinates?: LawyerCoordinates;
  clearCoordinates?: boolean;
  geocode?: {
    provider: GeocodeProviderName;
    precision: GeocodePrecision;
    confidence: GeocodeConfidence;
    geocodedAt?: string;
  };
};

export interface ProfileRepository {
  getById(id: string): Promise<Profile | null>;
  listAdminUsers(): Promise<AdminUserRecord[]>;
  listAdminUsersPage(input: PageInput): Promise<PageResult<AdminUserRecord>>;
  createClientProfile(input: { id: string; name: string; email: string }): Promise<Profile>;
  createLawyerProfile(
    input: Pick<LawyerCreate, "name" | "email" | "whatsapp" | "avatarUrl" | "coverUrl">,
    access?: { profileId?: string; accessInvitedAt?: string | null; mustChangePassword?: boolean }
  ): Promise<Profile>;
  updateLawyerProfile(profileId: string, input: Partial<Pick<LawyerCreate, "name" | "email" | "whatsapp" | "avatarUrl" | "coverUrl">>): Promise<void>;
  updateVisualFields(profileId: string, input: Pick<LawyerVisualFields, "avatarUrl" | "coverUrl">): Promise<void>;
  updateBlocked(profileId: string, blocked: boolean): Promise<AdminUserRecord | null>;
  markFirstLoginCompleted(profileId: string): Promise<Profile | null>;
  markPasswordChanged(profileId: string): Promise<Profile | null>;
}

export interface LegalSpecialtyRepository {
  listActive(): Promise<LegalSpecialty[]>;
}

export interface LawyerRepository {
  list(): Promise<LawyerRecord[]>;
  listPage(input: PageInput): Promise<PageResult<LawyerRecord>>;
  getById(id: string): Promise<LawyerRecord | null>;
  create(
    input: LawyerCreate,
    location?: LawyerOfficeLocation,
    access?: { profileId?: string; accessInvitedAt?: string | null; mustChangePassword?: boolean }
  ): Promise<LawyerRecord>;
  update(id: string, patch: LawyerPatch, location?: LawyerOfficeLocation): Promise<LawyerRecord | null>;
  activateAccess(lawyerId: string, access: { profileId: string; accessInvitedAt?: string | null }): Promise<LawyerRecord | null>;
}

/** Allowlist publica do perfil profissional exposto ao cliente autenticado. */
export type PublicLawyerProfile = {
  id: string;
  name: string;
  oabNumber: string;
  oabState: string;
  city: string | null;
  state: string | null;
  areaIds: string[];
  areas: Array<{ id: string; name: string }>;
  whatsapp: string;
  verified: true;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  miniBio?: string | null;
  fullBio?: string | null;
  instagramUrl?: string | null;
  linkedinUrl?: string | null;
  facebookUrl?: string | null;
  websiteUrl?: string | null;
  yearsExperience?: number | null;
  planLabel?: string | null;
  emergencyAvailable?: boolean;
};

export interface PublicLawyerProfileRepository {
  getApprovedById(id: string): Promise<PublicLawyerProfile | null>;
}

export type LawyerDashboard = {
  lawyer: {
    id: string;
    name: string;
    oabNumber: string;
    oabState: string;
    avatarUrl?: string | null;
    coverUrl?: string | null;
    planLabel: string;
    verified: boolean;
  };
  metrics: {
    profileViews: number;
    whatsappClicks: number;
    contacts: number;
    conversionRate: number;
  };
  benefits: Array<{
    id: string;
    title: string;
    description: string;
    badge?: string;
    redemptionUrl?: string | null;
  }>;
};

export interface LawyerDashboardRepository {
  getByProfileId(profileId: string): Promise<LawyerDashboard | null>;
}

export type LawyerEventType = "profile_view" | "whatsapp_click";
export type LawyerEventSource = "mobile" | "landing" | "admin" | "unknown";
export type LawyerInsightMetrics = LawyerDashboard["metrics"];

export interface LawyerEventRepository {
  record(input: {
    lawyerProfileId: string;
    actorProfileId?: string;
    eventType: LawyerEventType;
    source: LawyerEventSource;
    dedupeKey?: string;
  }): Promise<{ recorded: boolean; duplicate?: boolean }>;
  getMetrics(lawyerProfileId: string, input?: { since?: Date }): Promise<LawyerInsightMetrics>;
}

export type PrayerRequestRecord = {
  id: string;
  status: "received" | "read";
  createdAt: string;
  readAt?: string | null;
};

export type AdminPrayerRequestRecord = PrayerRequestRecord & {
  message: string;
  anonymous: boolean;
  client?: {
    id: string;
    name: string;
    email: string;
  } | null;
};

export interface PrayerRequestRepository {
  create(input: PrayerRequest & { clientProfileId: string }): Promise<PrayerRequestRecord>;
  listAdmin(): Promise<AdminPrayerRequestRecord[]>;
  listAdminPage(input: PageInput): Promise<PageResult<AdminPrayerRequestRecord>>;
  updateStatus(id: string, status: PrayerRequestRecord["status"]): Promise<AdminPrayerRequestRecord | null>;
}

export type StoredLawyerImage = {
  url: string;
  path: string;
  contentType: AdminLawyerImageUpload["mimeType"];
};

export interface LawyerMediaRepository {
  uploadImage(input: AdminLawyerImageUpload): Promise<StoredLawyerImage>;
}

export type PartnerLogoRecord = {
  id: string;
  name: string;
  logoUrl: string;
  websiteUrl?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StoredAdminImage = {
  url: string;
  path: string;
  contentType: AdminImageUpload["mimeType"];
};

export interface PartnerLogoRepository {
  listAdmin(): Promise<PartnerLogoRecord[]>;
  listAdminPage(input: PageInput): Promise<PageResult<PartnerLogoRecord>>;
  listPublic(): Promise<PartnerLogoRecord[]>;
  create(input: AdminPartnerLogoCreate): Promise<PartnerLogoRecord>;
  uploadLogo(input: AdminImageUpload): Promise<StoredAdminImage>;
}

export type BenefitRecord = {
  id: string;
  title: string;
  description: string;
  badge?: string | null;
  redemptionUrl?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export interface BenefitRepository {
  listAdmin(): Promise<BenefitRecord[]>;
  listAdminPage(input: PageInput): Promise<PageResult<BenefitRecord>>;
  listActive(): Promise<BenefitRecord[]>;
  create(input: AdminBenefitCreate): Promise<BenefitRecord>;
  update(id: string, patch: AdminBenefitPatch): Promise<BenefitRecord | null>;
  delete(id: string): Promise<boolean>;
}

export interface AuditLogRepository {
  record(input: {
    actorProfileId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export type NearestLawyerInput = {
  lat: number;
  lng: number;
  areaIds: string[];
  maxRadiusKm: number;
};

/** Campos seguros expostos ao cliente. Nunca inclui CEP, endereco completo nem PII interna. */
export type MatchedLawyer = {
  id: string;
  name: string;
  whatsapp: string;
  city: string | null;
  state: string | null;
  areaIds: string[];
  avatarUrl?: string | null;
  coverUrl?: string | null;
};

export type NearestLawyerResult = {
  lawyer: MatchedLawyer;
  distanceKm: number;
  distanceReliable?: boolean;
  distanceNotice?: string;
} | null;

export interface MatchRepository {
  findNearest(input: NearestLawyerInput): Promise<NearestLawyerResult>;
  findByCity(input: { stateId: string; cityId: string; areaIds: string[]; page: number; pageSize: 5 }): Promise<{
    lawyers: MatchedLawyer[];
    total: number;
  }>;
}

export type MatchEventInput = {
  clientProfileId?: string;
  lawyerProfileId?: string;
  lat: number;
  lng: number;
  accuracyM?: number;
  specialtyIds: string[];
  distanceKm?: number;
  algorithmVersion: string;
};

export interface MatchEventRepository {
  record(input: MatchEventInput): Promise<void>;
}

export type Repositories = {
  profiles: ProfileRepository;
  legalSpecialties: LegalSpecialtyRepository;
  geographies: GeographyRepository;
  lawyers: LawyerRepository;
  publicLawyerProfiles: PublicLawyerProfileRepository;
  lawyerDashboards: LawyerDashboardRepository;
  lawyerEvents: LawyerEventRepository;
  prayerRequests: PrayerRequestRepository;
  lawyerMedia: LawyerMediaRepository;
  partnerLogos: PartnerLogoRepository;
  benefits: BenefitRepository;
  auditLogs: AuditLogRepository;
  matches: MatchRepository;
  matchEvents: MatchEventRepository;
  mode: "memory" | "supabase";
};
