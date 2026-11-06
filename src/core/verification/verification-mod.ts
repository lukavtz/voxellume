import { isDeepStrictEqual } from "node:util";

import type {
  RuntimeAdapter,
  RuntimeAssertInput,
  RuntimeCallOptions,
  RuntimeCapabilities,
  RuntimeInput,
  RuntimeInputAction,
  RuntimeLaunchInput,
  RuntimeOperationName,
  RuntimeOperationResult,
  RuntimeProcessInput,
  RuntimeScreenshot,
  RuntimeScreenshotInput,
  RuntimeSession,
  RuntimeSettleInput,
  RuntimeTarget,
  RuntimeTransport,
  RuntimeWorldCreateInput,
} from "./runtime-adapter.ts";

const MAX_LINE_BYTES = 16_384;
const MAX_LINES = 256;
const MAX_SCREENSHOT_BYTES = 64 * 1024 * 1024;
const DEFAULT_CALL_TIMEOUT_MS = 10_000;

export type VerificationTargetStatus =
  "draft" | "candidate" | "supported" | "legacy" | "rejected" | "unsupported";

export interface VerificationModTarget extends RuntimeTarget {
  readonly status?: VerificationTargetStatus;
}

export interface VerificationScenario {
  readonly id: string;
  readonly seed: string;
  readonly camera: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly yaw: number;
    readonly pitch: number;
  };
  readonly ticks: number;
  readonly inputs: readonly RuntimeInputAction[];
  readonly assertions: readonly {
    readonly id: string;
    readonly condition: string;
  }[];
  readonly screenshots: readonly {
    readonly id: string;
    readonly path: string;
  }[];
  readonly production?: {
    readonly modId: string;
    readonly modVersion: string;
    readonly productionJarSha256: string;
    readonly environment: string;
    readonly minecraftVersion: string;
    readonly protocolVersion: number;
    readonly remapped: boolean;
    readonly dependencies: readonly {
      readonly id: string;
      readonly version: string;
    }[];
    readonly states: Readonly<Record<string, string>>;
    readonly multiplayer: {
      readonly actor: string;
      readonly observer: string;
      readonly serverSessionId: string;
      readonly synchronized: boolean;
    };
    readonly modpack: {
      readonly id: string;
      readonly version: string;
      readonly declaredMods: readonly string[];
      readonly compatible: boolean;
    };
  };
}

export interface VerificationModGenerationInput {
  readonly target: VerificationModTarget;
  readonly instanceId: string;
  readonly token: string;
  readonly scenario: VerificationScenario;
}

export interface GeneratedVerificationModFile {
  readonly outputPath: string;
  readonly contents: Buffer;
}

export interface GeneratedVerificationMod {
  readonly status: "generated";
  readonly files: readonly GeneratedVerificationModFile[];
}

export type VerificationModGenerationResult =
  | GeneratedVerificationMod
  | {
      readonly status: "unsupported";
      readonly code: "unsupported_target";
      readonly target: VerificationModTarget;
    }
  | { readonly status: "failed"; readonly code: "invalid_instance_id" }
  | {
      readonly status: "failed";
      readonly code: "unsafe_scenario";
      readonly field: string;
    };

export interface VerificationModLauncher {
  terminateOwnedPids(ownedPids: readonly number[]): Promise<{
    readonly terminatedOwnedPids: readonly number[];
    readonly remainingOwnedPids: readonly number[];
  }>;
}

export interface CreateVerificationModAdapterOptions {
  readonly target: VerificationModTarget;
  readonly instanceId: string;
  readonly transport?: RuntimeTransport;
  readonly scenario?: VerificationScenario;
  readonly launcher?: VerificationModLauncher;
  readonly deadlineMs?: number;
}

export type CreateVerificationModAdapterResult =
  | { readonly status: "available"; readonly adapter: RuntimeAdapter }
  | {
      readonly status: "unsupported";
      readonly code: "unsupported_target";
      readonly target: VerificationModTarget;
    }
  | { readonly status: "unavailable"; readonly code: "invalid_instance_id" };

function supportedTarget(target: VerificationModTarget): boolean {
  return (
    target.loader === "fabric" &&
    target.minecraftVersion === "1.21.1" &&
    (target.status === undefined ||
      target.status === "candidate" ||
      target.status === "supported")
  );
}

function validInstanceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value);
}

function safeLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^[A-Za-z0-9_.:-]+$/.test(value)
  );
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function safeText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 4_096 &&
    !hasControlCharacters(value)
  );
}

function safeCondition(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 512 &&
    (/^(?:client\.inWorld|player\.mainHand|player\.inventory\.contains|player\.health|player\.onGround|player\.position\.[xyz]|block\.at\(-?\d+,-?\d+,-?\d+\))\s*(?:==|!=|>=|<=|>|<)\s*(?:true|false|-?\d+(?:\.\d+)?|[a-z][a-z0-9_]*:[a-z0-9_./-]+)$/.test(
      value,
    ) ||
      /^production\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*(?::[a-z][a-z0-9_]*)?$/.test(
        value,
      ))
  );
}

function supportedAssertionCondition(value: string): boolean {
  if (!value.startsWith("production.")) return safeCondition(value);
  return (
    value === "production.identity" ||
    /^production\.(?:server_behavior|persistence\.before|persistence\.after|multiplayer|modpack):[a-z][a-z0-9_]*$/.test(
      value,
    )
  );
}

function expectedFields(
  observed: unknown,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  const actual = objectValue(observed);
  return (
    actual !== undefined &&
    Object.entries(expected).every(([key, value]) =>
      isDeepStrictEqual(actual[key], value),
    )
  );
}

function matchesProductionObservation(
  scenario: VerificationScenario | undefined,
  condition: string,
  sessionId: string,
  observed: unknown,
): boolean | undefined {
  const production = scenario?.production;
  if (production === undefined) return undefined;
  if (condition === "production.identity") {
    const actual = objectValue(observed);
    const remap = objectValue(actual?.remap);
    return (
      expectedFields(observed, {
        environment: production.environment,
        productionJarSha256: production.productionJarSha256,
        modId: production.modId,
        modVersion: production.modVersion,
        minecraftVersion: production.minecraftVersion,
        protocolVersion: production.protocolVersion,
        remapped: production.remapped,
        dependencies: production.dependencies,
      }) &&
      remap?.sourceNamespace === "mojang" &&
      remap.runtimeNamespace === "intermediary" &&
      typeof remap.mappedClass === "string" &&
      remap.mappedClass.length > 0
    );
  }
  const stateMatch =
    /^production\.(server_behavior|persistence\.before|persistence\.after|multiplayer):([a-z][a-z0-9_]*)$/.exec(
      condition,
    );
  if (stateMatch !== null) {
    const kind = stateMatch[1]!;
    const id = stateMatch[2]!;
    const expectedState = production.states[id];
    if (expectedState === undefined) return undefined;
    if (!expectedFields(observed, { id, state: expectedState })) return false;
    const actual = objectValue(observed)!;
    if (kind === "server_behavior") {
      const oracle = objectValue(actual.oracle);
      const state = /^damage=(\d+);remaining=(\d+)$/.exec(expectedState);
      return (
        oracle?.kind === "item_durability" &&
        typeof oracle.item === "string" &&
        state !== null &&
        oracle.damage === Number(state[1]) &&
        oracle.remaining === Number(state[2])
      );
    }
    if (kind === "persistence.before")
      return actual.savedState === expectedState;
    if (kind === "persistence.after") {
      return (
        actual.savedState === expectedState &&
        actual.restoredState === expectedState &&
        safeLabel(actual.sessionId)
      );
    }
    return (
      (actual.participant === production.multiplayer.actor ||
        actual.participant === production.multiplayer.observer) &&
      expectedFields(observed, {
        ...production.multiplayer,
        sessionId,
        sharedState: expectedState,
      }) &&
      Number.isSafeInteger(actual.serverTick) &&
      (actual.serverTick as number) >= 0
    );
  }
  if (condition.startsWith("production.modpack:")) {
    if (condition !== `production.modpack:${production.modpack.id}`) {
      return undefined;
    }
    if (!expectedFields(observed, production.modpack)) return false;
    const loaded = objectValue(observed)?.loadedMods;
    if (
      !Array.isArray(loaded) ||
      loaded.length !== production.modpack.declaredMods.length
    ) {
      return false;
    }
    return production.modpack.declaredMods.every((declaration, index) => {
      const separator = declaration.lastIndexOf("@");
      const actual = objectValue(loaded[index]);
      return (
        actual?.id === declaration.slice(0, separator) &&
        actual.version === declaration.slice(separator + 1) &&
        typeof actual.origin === "string" &&
        actual.origin.length > 0 &&
        typeof actual.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(actual.sha256)
      );
    });
  }
  return undefined;
}

function safeRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function validAction(action: RuntimeInputAction): boolean {
  if (action.kind === "text") return safeText(action.text);
  if (action.kind === "key") {
    return (
      safeLabel(action.key) &&
      ["tap", "press", "release", "hold"].includes(action.action) &&
      (action.holdTicks === undefined ||
        (Number.isSafeInteger(action.holdTicks) &&
          action.holdTicks >= 1 &&
          action.holdTicks <= 11_900)) &&
      (action.holdMs === undefined ||
        (Number.isSafeInteger(action.holdMs) &&
          action.holdMs >= 1 &&
          action.holdMs <= 60_000)) &&
      (action.modifiers === undefined ||
        action.modifiers.every((modifier) => safeLabel(modifier)))
    );
  }
  if (action.kind === "mouse") {
    return (
      ["click", "move", "down", "up"].includes(action.action) &&
      Number.isFinite(action.x) &&
      Number.isFinite(action.y) &&
      (action.button === undefined ||
        (Number.isSafeInteger(action.button) &&
          action.button >= 0 &&
          action.button <= 16))
    );
  }
  return (
    Number.isFinite(action.deltaY) &&
    (action.deltaX === undefined || Number.isFinite(action.deltaX)) &&
    (action.x === undefined || Number.isFinite(action.x)) &&
    (action.y === undefined || Number.isFinite(action.y))
  );
}

function unsafeProductionField(
  production: NonNullable<VerificationScenario["production"]>,
): string | undefined {
  if (!safeIdentifier(production.modId)) return "scenario.production.modId";
  if (!safeLabel(production.modVersion))
    return "scenario.production.modVersion";
  if (!/^[0-9a-f]{64}$/.test(production.productionJarSha256)) {
    return "scenario.production.productionJarSha256";
  }
  if (production.environment !== "production")
    return "scenario.production.environment";
  if (production.minecraftVersion !== "1.21.1") {
    return "scenario.production.minecraftVersion";
  }
  if (
    !Number.isSafeInteger(production.protocolVersion) ||
    production.protocolVersion < 1
  ) {
    return "scenario.production.protocolVersion";
  }
  if (production.remapped !== true) return "scenario.production.remapped";
  if (production.dependencies.length === 0)
    return "scenario.production.dependencies";
  for (const [index, dependency] of production.dependencies.entries()) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(dependency.id)) {
      return `scenario.production.dependencies[${index}].id`;
    }
    if (!/^[A-Za-z0-9_.:+-]+$/.test(dependency.version)) {
      return `scenario.production.dependencies[${index}].version`;
    }
  }
  for (const [id, state] of Object.entries(production.states)) {
    if (!safeIdentifier(id)) return "scenario.production.states";
    if (!safeText(state) || state.length === 0 || state.length > 512) {
      return `scenario.production.states.${id}`;
    }
  }
  if (!safeLabel(production.multiplayer.actor))
    return "scenario.production.multiplayer.actor";
  if (!safeLabel(production.multiplayer.observer)) {
    return "scenario.production.multiplayer.observer";
  }
  if (production.multiplayer.actor === production.multiplayer.observer) {
    return "scenario.production.multiplayer";
  }
  if (!safeLabel(production.multiplayer.serverSessionId)) {
    return "scenario.production.multiplayer.serverSessionId";
  }
  if (production.multiplayer.synchronized !== true) {
    return "scenario.production.multiplayer.synchronized";
  }
  if (!safeIdentifier(production.modpack.id))
    return "scenario.production.modpack.id";
  if (!safeLabel(production.modpack.version))
    return "scenario.production.modpack.version";
  if (production.modpack.compatible !== true) {
    return "scenario.production.modpack.compatible";
  }
  if (production.modpack.declaredMods.length === 0) {
    return "scenario.production.modpack.declaredMods";
  }
  for (const [index, mod] of production.modpack.declaredMods.entries()) {
    if (!/^[a-z][a-z0-9_-]*@[A-Za-z0-9_.:+-]+$/.test(mod)) {
      return `scenario.production.modpack.declaredMods[${index}]`;
    }
  }
  return undefined;
}

function unsafeScenarioField(
  scenario: VerificationScenario,
): string | undefined {
  if (!safeIdentifier(scenario.id)) return "scenario.id";
  if (!safeLabel(scenario.seed)) return "scenario.seed";
  if (
    !Object.values(scenario.camera).every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  ) {
    return "scenario.camera";
  }
  if (
    !Number.isSafeInteger(scenario.ticks) ||
    scenario.ticks < 1 ||
    scenario.ticks > 11_900
  ) {
    return "scenario.ticks";
  }
  if (!Array.isArray(scenario.inputs) || scenario.inputs.length > MAX_LINES) {
    return "scenario.inputs";
  }
  for (const [index, action] of scenario.inputs.entries()) {
    if (!validAction(action)) return `scenario.inputs[${index}]`;
  }
  if (
    !Array.isArray(scenario.assertions) ||
    scenario.assertions.length > MAX_LINES
  ) {
    return "scenario.assertions";
  }
  const assertionIds = new Set<string>();
  for (const [index, assertion] of scenario.assertions.entries()) {
    if (!safeIdentifier(assertion.id))
      return `scenario.assertions[${index}].id`;
    if (!safeCondition(assertion.condition)) {
      return `scenario.assertions[${index}].condition`;
    }
    if (assertionIds.has(assertion.id))
      return `scenario.assertions[${index}].id`;
    assertionIds.add(assertion.id);
  }
  if (
    !Array.isArray(scenario.screenshots) ||
    scenario.screenshots.length > MAX_LINES
  ) {
    return "scenario.screenshots";
  }
  const screenshotIds = new Set<string>();
  for (const [index, screenshot] of scenario.screenshots.entries()) {
    if (!safeIdentifier(screenshot.id))
      return `scenario.screenshots[${index}].id`;
    if (
      !safeRelativePath(screenshot.path) ||
      !screenshot.path.toLowerCase().endsWith(".png")
    ) {
      return `scenario.screenshots[${index}].path`;
    }
    if (screenshotIds.has(screenshot.id)) {
      return `scenario.screenshots[${index}].id`;
    }
    screenshotIds.add(screenshot.id);
  }
  if (scenario.production !== undefined)
    return unsafeProductionField(scenario.production);
  return undefined;
}

function jsonFile(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function bridgeSource(input: VerificationModGenerationInput): string {
  return `package dev.voxellume.verification;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.NativeImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.fabricmc.loader.api.metadata.ModDependency;
import net.minecraft.SharedConstants;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.Difficulty;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LevelSettings;
import net.minecraft.world.level.WorldDataConfiguration;
import net.minecraft.world.level.levelgen.WorldDimensions;
import net.minecraft.world.level.levelgen.WorldOptions;
import net.minecraft.core.registries.Registries;

/** Fabric 1.21.1 client-only verification bridge. No command executor exists. */
public final class VoxellumeVerificationBridge {
    public static final String EXPECTED_INSTANCE_ID = "${input.instanceId}";
    public static final String EXPECTED_MINECRAFT_VERSION = "1.21.1";
    private static final int MAX_LINE_BYTES = ${MAX_LINE_BYTES};
    private static final int MAX_LINES = ${MAX_LINES};
    private static final Set<String> ALLOWED_OPERATIONS = Set.of(
        "worldCreate", "settle", "input", "assert", "screenshot", "cancel", "cleanup");
    private static final Gson GSON = new Gson();
    private static final String ACTUAL_MINECRAFT_VERSION =
        SharedConstants.getCurrentVersion().getName();
    private static final String ACTUAL_LOADER_VERSION = FabricLoader.getInstance()
        .getModContainer("fabricloader").orElseThrow()
        .getMetadata().getVersion().getFriendlyString();
    private static volatile ServerSocket serverSocket;
    private static volatile Path runtimeConfig;
    private static volatile TickOperation tickOperation;
    private static volatile WorldOperation worldOperation;
    private static JsonObject scenario;

    private VoxellumeVerificationBridge() {}

    public static synchronized void start() {
        if (serverSocket != null) return;
        Thread thread = new Thread(VoxellumeVerificationBridge::serve, "voxellume-test-only-bridge");
        thread.setDaemon(true);
        thread.start();
    }

    static {
        ClientTickEvents.END_CLIENT_TICK.register(VoxellumeVerificationBridge::onClientTick);
    }

    private static JsonObject resource(String name) throws IOException {
        try (InputStream stream = VoxellumeVerificationBridge.class.getResourceAsStream(name)) {
            if (stream == null) throw new IOException("missing test resource");
            return JsonParser.parseString(new String(stream.readAllBytes(), StandardCharsets.UTF_8))
                .getAsJsonObject();
        }
    }

    private static void serve() {
        try {
            UUID.fromString(EXPECTED_INSTANCE_ID);
            JsonObject config = resource("/voxellume-bridge.json");
            scenario = resource("/voxellume-scenario.json");
            if (!EXPECTED_INSTANCE_ID.equals(scenario.get("instanceId").getAsString())
                || !EXPECTED_MINECRAFT_VERSION.equals(ACTUAL_MINECRAFT_VERSION)
                || !EXPECTED_MINECRAFT_VERSION.equals(
                    scenario.getAsJsonObject("target").get("minecraftVersion").getAsString())
                || !"json-lines".equals(config.get("protocol").getAsString())
                || !"127.0.0.1".equals(config.get("host").getAsString())
                || config.get("port").getAsInt() != 0
                || config.get("maxLineBytes").getAsInt() != MAX_LINE_BYTES
                || config.get("maxLines").getAsInt() != MAX_LINES) {
                throw new IOException("verification identity or protocol mismatch");
            }
            byte[] token = config.get("token").getAsString().getBytes(StandardCharsets.UTF_8);
            ServerSocket server = new ServerSocket();
            server.bind(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 1);
            serverSocket = server;
            config.addProperty("port", server.getLocalPort());
            config.addProperty("actualMinecraftVersion", ACTUAL_MINECRAFT_VERSION);
            config.addProperty("actualLoaderVersion", ACTUAL_LOADER_VERSION);
            publishRuntimeConfig(config);
            while (!server.isClosed()) {
                try (Socket socket = server.accept()) {
                    socket.setSoTimeout(10_000);
                    serveConnection(socket, token);
                } catch (IOException error) {
                    if (!server.isClosed()) publishFailure("connection_failed");
                }
            }
        } catch (IOException error) {
            publishFailure("bridge_unavailable");
        }
    }

    private static void publishRuntimeConfig(JsonObject config) throws IOException {
        Path root = FabricLoader.getInstance().getGameDir().resolve("voxellume-verification");
        Files.createDirectories(root);
        runtimeConfig = root.resolve("bridge.json");
        Path temporary = root.resolve("bridge.json.tmp");
        Files.writeString(temporary, GSON.toJson(config) + "\\n", StandardCharsets.UTF_8,
            StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE);
        try {
            Files.move(temporary, runtimeConfig, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException error) {
            throw new IOException("atomic bridge publication unavailable", error);
        }
        try {
            Files.setPosixFilePermissions(runtimeConfig, Set.of(
                java.nio.file.attribute.PosixFilePermission.OWNER_READ,
                java.nio.file.attribute.PosixFilePermission.OWNER_WRITE));
        } catch (UnsupportedOperationException ignored) {
            // The isolated test root remains the authorization boundary on non-POSIX hosts.
        }
    }

    private static void publishFailure(String code) {
        if (runtimeConfig == null) return;
        try {
            JsonObject failure = new JsonObject();
            failure.addProperty("status", "unavailable");
            failure.addProperty("code", code);
            failure.addProperty("instanceId", EXPECTED_INSTANCE_ID);
            failure.addProperty("minecraftVersion", ACTUAL_MINECRAFT_VERSION);
            Files.writeString(runtimeConfig, GSON.toJson(failure) + "\\n", StandardCharsets.UTF_8,
                StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
        } catch (IOException ignored) {
            // Absence of a valid published configuration also means unavailable.
        }
    }

    private static void serveConnection(Socket socket, byte[] token) throws IOException {
        InputStream input = socket.getInputStream();
        OutputStream output = socket.getOutputStream();
        for (int lineNumber = 0; lineNumber < MAX_LINES; lineNumber++) {
            String line = readBoundedLine(input);
            if (line == null) return;
            JsonObject response;
            try {
                JsonObject request = JsonParser.parseString(line).getAsJsonObject();
                byte[] supplied = request.get("token").getAsString().getBytes(StandardCharsets.UTF_8);
                if (!MessageDigest.isEqual(token, supplied)) {
                    response = result("failed", "authentication_failed");
                } else {
                    String operation = request.get("operation").getAsString();
                    if (!ALLOWED_OPERATIONS.contains(operation)) {
                        response = result("unsupported", "operation_not_allowed");
                    } else {
                        response = dispatch(operation, request.getAsJsonObject("args"));
                    }
                }
            } catch (Exception error) {
                response = result("failed", "invalid_request");
            }
            output.write((GSON.toJson(response) + "\\n").getBytes(StandardCharsets.UTF_8));
            output.flush();
        }
    }

    private static JsonObject dispatch(String operation, JsonObject args) throws Exception {
        if (operation.equals("worldCreate")) {
            if (worldOperation != null) return result("unavailable", "world_create_busy");
            Minecraft client = Minecraft.getInstance();
            CompletableFuture<JsonObject> future = new CompletableFuture<>();
            client.execute(() -> startWorldCreate(client, args, future));
            long timeoutMs = args.has("timeoutMs") ? args.get("timeoutMs").getAsLong()
                : 600_000L;
            if (timeoutMs < 1 || timeoutMs > 600_000) return result("failed", "invalid_timeout");
            return future.get(timeoutMs, TimeUnit.MILLISECONDS);
        }
        if (operation.equals("cancel")) {
            KeyMapping.releaseAll();
            TickOperation pending = tickOperation;
            tickOperation = null;
            if (pending != null) pending.future.complete(result("cancelled", "cancelled"));
            WorldOperation pendingWorld = worldOperation;
            worldOperation = null;
            if (pendingWorld != null) {
                pendingWorld.future.complete(result("cancelled", "cancelled"));
            }
            JsonObject result = result("passed", null);
            result.addProperty("cancelled", true);
            result.addProperty("keysReleased", true);
            result.addProperty("cancelledAtTick", Minecraft.getInstance().level == null
                ? -1 : Minecraft.getInstance().level.getGameTime());
            return result;
        }
        if (operation.equals("cleanup")) {
            KeyMapping.releaseAll();
            if (serverSocket != null) serverSocket.close();
            if (runtimeConfig != null) Files.deleteIfExists(runtimeConfig);
            JsonObject result = result("passed", null);
            result.addProperty("acknowledged", true);
            result.addProperty("cleanedUp", true);
            result.addProperty("runtimeConfigRemoved", runtimeConfig == null
                || !Files.exists(runtimeConfig));
            return result;
        }

        Minecraft client = Minecraft.getInstance();
        CompletableFuture<JsonObject> future = new CompletableFuture<>();
        client.execute(() -> {
            try {
                switch (operation) {
                    case "settle" -> startTickWait(client, args, null, future);
                    case "input" -> startInput(client, args, future);
                    case "assert" -> future.complete(assertOnClient(client, args));
                    case "screenshot" -> future.complete(captureScreenshot(client, args));
                    default -> future.complete(result("unsupported", "operation_not_allowed"));
                }
            } catch (Exception error) {
                future.complete(result("failed", "operation_failed"));
            }
        });
        long defaultTimeoutMs = 10_000L;
        if (operation.equals("settle")) {
            defaultTimeoutMs = args.get("ticks").getAsLong() * 50L + 5_000L;
        } else if (operation.equals("input")
            && args.getAsJsonObject("action").get("action").getAsString().equals("hold")) {
            defaultTimeoutMs = args.getAsJsonObject("action").get("holdTicks").getAsLong()
                * 50L + 5_000L;
        }
        long timeoutMs = args.has("timeoutMs") ? args.get("timeoutMs").getAsLong()
            : defaultTimeoutMs;
        if (timeoutMs < 1 || timeoutMs > 600_000) return result("failed", "invalid_timeout");
        return future.get(timeoutMs, TimeUnit.MILLISECONDS);
    }

    private static void startWorldCreate(Minecraft client, JsonObject args,
        CompletableFuture<JsonObject> future) {
        try {
            String name = args.get("name").getAsString();
            String seed = args.get("seed").getAsString();
            if (!args.get("isolated").getAsBoolean()
                || !name.startsWith("voxellume-")
                || !name.matches("[A-Za-z0-9_.:-]+")
                || !seed.matches("[A-Za-z0-9_.:-]+")) {
                future.complete(result("failed", "invalid_world_input"));
                return;
            }
            Path save = FabricLoader.getInstance().getGameDir().resolve("saves").resolve(name);
            if (Files.exists(save)) {
                future.complete(result("failed", "world_already_exists"));
                return;
            }
            LevelSettings settings = new LevelSettings(name, GameType.CREATIVE, false,
                Difficulty.PEACEFUL, false, new GameRules(), WorldDataConfiguration.DEFAULT);
            WorldOptions options = new WorldOptions(WorldOptions.parseSeed(seed).orElseThrow(),
                true, false);
            worldOperation = new WorldOperation(name, seed, future);
            client.createWorldOpenFlows().createFreshLevel(name, settings, options,
                registryAccess -> new WorldDimensions(
                    registryAccess.registryOrThrow(Registries.LEVEL_STEM)), client.screen);
        } catch (Exception error) {
            worldOperation = null;
            future.complete(result("failed", "world_create_failed"));
        }
    }

    private static void startTickWait(Minecraft client, JsonObject args, KeyMapping release,
        CompletableFuture<JsonObject> future) {
        if (tickOperation != null) {
            future.complete(result("unavailable", "tick_wait_busy"));
            return;
        }
        if (client.level == null || client.player == null) {
            future.complete(result("unavailable", "world_required"));
            return;
        }
        int ticks = args.get("ticks").getAsInt();
        if (ticks < 1 || ticks > 11_900) {
            future.complete(result("failed", "invalid_ticks"));
            return;
        }
        boolean synchronize = args.has("synchronize")
            && args.get("synchronize").getAsBoolean();
        if (synchronize && client.getSingleplayerServer() == null) {
            future.complete(result("unsupported", "server_synchronize_unavailable"));
            return;
        }
        JsonObject camera = scenario.getAsJsonObject("camera");
        client.player.setPos(camera.get("x").getAsDouble(), camera.get("y").getAsDouble(),
            camera.get("z").getAsDouble());
        client.player.setYRot(camera.get("yaw").getAsFloat());
        client.player.setXRot(camera.get("pitch").getAsFloat());
        tickOperation = new TickOperation(ticks, client.level.getGameTime(), synchronize,
            release, future);
    }

    private static void startInput(Minecraft client, JsonObject args,
        CompletableFuture<JsonObject> future) {
        JsonObject action = args.getAsJsonObject("action");
        if (!"key".equals(action.get("kind").getAsString())
            || !"W".equals(action.get("key").getAsString())
            || action.has("holdMs") || action.has("modifiers")) {
            future.complete(result("unsupported", "input_unavailable"));
            return;
        }
        String operation = action.get("action").getAsString();
        KeyMapping forward = client.options.keyUp;
        if (operation.equals("press") || operation.equals("release")) {
            boolean down = operation.equals("press");
            forward.setDown(down);
            JsonObject result = result("passed", null);
            result.add("appliedAction", action);
            result.addProperty("keyDown", forward.isDown());
            result.addProperty("atTick", client.level == null ? -1 : client.level.getGameTime());
            future.complete(result);
            return;
        }
        if (operation.equals("hold") && !action.has("holdTicks")) {
            future.complete(result("failed", "hold_ticks_required"));
            return;
        }
        int ticks = operation.equals("tap") ? 1 : action.get("holdTicks").getAsInt();
        forward.setDown(true);
        JsonObject tickArgs = new JsonObject();
        tickArgs.addProperty("ticks", ticks);
        tickArgs.addProperty("synchronize", false);
        CompletableFuture<JsonObject> tickFuture = new CompletableFuture<>();
        startTickWait(client, tickArgs, forward, tickFuture);
        tickFuture.thenAccept(result -> {
            result.add("appliedAction", action);
            result.addProperty("keyDown", forward.isDown());
            result.addProperty("atTick", result.get("endTick").getAsLong());
            future.complete(result);
        });
    }

    private static void onClientTick(Minecraft client) {
        WorldOperation world = worldOperation;
        if (world != null && client.level != null && client.player != null
            && client.getSingleplayerServer() != null) {
            worldOperation = null;
            JsonObject created = result("passed", null);
            created.addProperty("worldName", world.name);
            created.addProperty("seed", world.seed);
            created.addProperty("isolated", true);
            created.addProperty("startedAtTick", client.level.getGameTime());
            world.future.complete(created);
        }

        TickOperation current = tickOperation;
        if (current == null) return;
        current.remaining--;
        if (current.remaining > 0) return;
        tickOperation = null;
        if (current.release != null) current.release.setDown(false);
        long endTick = client.level == null ? -1 : client.level.getGameTime();
        if (current.synchronize && client.getSingleplayerServer() != null) {
            client.getSingleplayerServer().execute(
                () -> current.future.complete(tickResult(current, endTick, true)));
        } else {
            current.future.complete(tickResult(current, endTick, false));
        }
    }

    private static JsonObject tickResult(TickOperation operation, long endTick,
        boolean synchronizedWithServer) {
        JsonObject result = result("passed", null);
        result.addProperty("startTick", operation.startTick);
        result.addProperty("endTick", endTick);
        result.addProperty("synchronized", synchronizedWithServer);
        return result;
    }

    private static JsonObject productionAssertion(Minecraft client, JsonObject args,
        String condition) {
        try {
            if (condition.equals("production.identity")) {
                JsonObject definition = productionDefinition();
                ModContainer mod = productionMod();
                if (definition == null || mod == null) {
                    return result("unavailable", "production_source_unavailable");
                }
                if (mod.getOrigin().getPaths().size() != 1
                    || !Files.isRegularFile(mod.getOrigin().getPaths().getFirst())) {
                    return result("unavailable", "production_jar_unavailable");
                }
                JsonObject observed = new JsonObject();
                observed.addProperty("environment",
                    FabricLoader.getInstance().isDevelopmentEnvironment()
                        ? "development" : "production");
                observed.addProperty("productionJarSha256",
                    sha256File(mod.getOrigin().getPaths().getFirst()));
                observed.addProperty("modId", mod.getMetadata().getId());
                observed.addProperty("modVersion",
                    mod.getMetadata().getVersion().getFriendlyString());
                observed.addProperty("minecraftVersion", ACTUAL_MINECRAFT_VERSION);
                observed.addProperty("protocolVersion", SharedConstants.getProtocolVersion());
                String runtimeNamespace = FabricLoader.getInstance().getMappingResolver()
                    .getCurrentRuntimeNamespace();
                String mappedClass = FabricLoader.getInstance().getMappingResolver()
                    .mapClassName("mojang", "net.minecraft.world.item.ItemStack");
                observed.addProperty("remapped", runtimeNamespace.equals("intermediary"));
                JsonObject remap = new JsonObject();
                remap.addProperty("sourceNamespace", "mojang");
                remap.addProperty("runtimeNamespace", runtimeNamespace);
                remap.addProperty("mappedClass", mappedClass);
                observed.add("remap", remap);
                JsonArray dependencies = new JsonArray();
                for (ModDependency dependency : mod.getMetadata().getDependencies()) {
                    if (dependency.getKind() != ModDependency.Kind.DEPENDS) continue;
                    ModContainer required = FabricLoader.getInstance()
                        .getModContainer(dependency.getModId()).orElse(null);
                    if (required == null) return result("unavailable", "dependency_unavailable");
                    JsonObject entry = new JsonObject();
                    entry.addProperty("id", dependency.getModId());
                    entry.addProperty("version",
                        required.getMetadata().getVersion().getFriendlyString());
                    dependencies.add(entry);
                }
                observed.add("dependencies", dependencies);
                JsonObject expected = new JsonObject();
                for (String key : Set.of("environment", "productionJarSha256", "modId",
                    "modVersion", "minecraftVersion", "protocolVersion", "remapped",
                    "dependencies")) {
                    if (!definition.has(key)) return result("unavailable", "definition_unavailable");
                    expected.add(key, definition.get(key));
                }
                boolean matched = true;
                for (String key : Set.of("environment", "productionJarSha256", "modId",
                    "modVersion", "minecraftVersion", "protocolVersion", "remapped",
                    "dependencies")) {
                    matched &= observed.get(key).equals(definition.get(key));
                }
                return productionResult(condition, observed, matched, client);
            }
            if (condition.startsWith("production.server_behavior:")) {
                String id = condition.substring("production.server_behavior:".length());
                String expectedState = expectedProductionState(id);
                if (expectedState == null) return result("unavailable", "definition_unavailable");
                JsonObject observed = productionState(client, id);
                return observed == null ? result("unavailable", "game_state_unavailable")
                    : productionResult(condition, observed,
                        expectedState.equals(observed.get("state").getAsString()), client);
            }
            if (condition.startsWith("production.persistence.before:")) {
                String id = condition.substring("production.persistence.before:".length());
                String expectedState = expectedProductionState(id);
                if (expectedState == null) return result("unavailable", "definition_unavailable");
                JsonObject observed = productionState(client, id);
                if (observed == null || !id.matches("[a-z][a-z0-9_]*")) {
                    return result("unavailable", "game_state_unavailable");
                }
                if (!expectedState.equals(observed.get("state").getAsString())) {
                    return productionResult(condition, observed, false, client);
                }
                Path snapshot = FabricLoader.getInstance().getGameDir()
                    .resolve("voxellume-verification").resolve("persistence")
                    .resolve(id + ".json");
                Files.createDirectories(snapshot.getParent());
                Files.writeString(snapshot, GSON.toJson(observed), StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE);
                observed.addProperty("savedState", observed.get("state").getAsString());
                return productionResult(condition, observed, true, client);
            }
            if (condition.startsWith("production.persistence.after:")) {
                String id = condition.substring("production.persistence.after:".length());
                if (!id.matches("[a-z][a-z0-9_]*")) {
                    return result("failed", "invalid_assertion");
                }
                String expectedState = expectedProductionState(id);
                if (expectedState == null) return result("unavailable", "definition_unavailable");
                Path snapshot = FabricLoader.getInstance().getGameDir()
                    .resolve("voxellume-verification").resolve("persistence")
                    .resolve(id + ".json");
                if (!Files.isRegularFile(snapshot)) {
                    return result("unavailable", "before_state_unavailable");
                }
                JsonObject before = JsonParser.parseString(Files.readString(snapshot,
                    StandardCharsets.UTF_8)).getAsJsonObject();
                JsonObject observed = productionState(client, id);
                if (observed == null) return result("unavailable", "game_state_unavailable");
                String restoredState = observed.get("state").getAsString();
                boolean preserved = before.get("state").getAsString().equals(restoredState)
                    && expectedState.equals(restoredState);
                observed.addProperty("savedState", before.get("state").getAsString());
                observed.addProperty("restoredState", restoredState);
                String serverSessionId = System.getProperty(
                    "voxellume.production.serverSessionId", "");
                if (serverSessionId.isBlank()) {
                    return result("unavailable", "persistence_session_unavailable");
                }
                observed.addProperty("sessionId", serverSessionId);
                return productionResult(condition, observed, preserved, client);
            }
            if (condition.startsWith("production.multiplayer:")) {
                JsonObject definition = productionDefinition();
                if (definition == null || !definition.has("multiplayer")) {
                    return result("unavailable", "definition_unavailable");
                }
                JsonObject multiplayer = definition.getAsJsonObject("multiplayer");
                String id = condition.substring("production.multiplayer:".length());
                String expectedState = expectedProductionState(id);
                if (expectedState == null || client.player == null
                    || client.getConnection() == null || client.getCurrentServer() == null
                    || client.getSingleplayerServer() != null) {
                    return result("unavailable", "dedicated_server_unavailable");
                }
                String actor = multiplayer.get("actor").getAsString();
                String observer = multiplayer.get("observer").getAsString();
                String serverSessionId = System.getProperty(
                    "voxellume.production.serverSessionId", "");
                if (actor.equals(observer) || serverSessionId.isBlank()
                    || !serverSessionId.equals(multiplayer.get("serverSessionId").getAsString())
                    || client.getConnection().getPlayerInfo(actor) == null
                    || client.getConnection().getPlayerInfo(observer) == null) {
                    return result("unavailable", "multiplayer_source_unavailable");
                }
                Player actorPlayer = client.level.getPlayerByUUID(client.getConnection()
                    .getPlayerInfo(actor).getProfile().getId());
                Player observerPlayer = client.level.getPlayerByUUID(client.getConnection()
                    .getPlayerInfo(observer).getProfile().getId());
                if (actorPlayer == null || observerPlayer == null) {
                    return result("unavailable", "multiplayer_state_unavailable");
                }
                JsonObject actorState = productionStateForPlayer(actorPlayer, id);
                JsonObject observerState = productionStateForPlayer(observerPlayer, id);
                if (actorState == null || observerState == null) {
                    return result("unavailable", "multiplayer_state_unavailable");
                }
                String participant = client.player.getGameProfile().getName();
                if (!participant.equals(actor) && !participant.equals(observer)) {
                    return result("unavailable", "multiplayer_participant_unavailable");
                }
                JsonObject observed = productionStateForPlayer(client.player, id);
                observed.addProperty("actor", actor);
                observed.addProperty("observer", observer);
                observed.addProperty("participant", participant);
                observed.addProperty("sessionId", args.get("sessionId").getAsString());
                observed.addProperty("serverSessionId", serverSessionId);
                boolean synchronizedState = actorState.get("state").equals(observerState.get("state"));
                observed.addProperty("sharedState", actorState.get("state").getAsString());
                observed.addProperty("serverTick", client.level.getGameTime());
                observed.addProperty("synchronized", synchronizedState);
                boolean matched = synchronizedState == multiplayer.get("synchronized").getAsBoolean()
                    && expectedState.equals(actorState.get("state").getAsString())
                    && expectedState.equals(observerState.get("state").getAsString());
                return productionResult(condition, observed, matched, client);
            }
            if (condition.startsWith("production.modpack:")) {
                JsonObject definition = productionDefinition();
                if (definition == null || !definition.has("modpack") || productionMod() == null) {
                    return result("unavailable", "definition_unavailable");
                }
                JsonObject expected = definition.getAsJsonObject("modpack");
                String actualId = System.getProperty("voxellume.production.modpack.id", "");
                String actualVersion = System.getProperty(
                    "voxellume.production.modpack.version", "");
                JsonObject observed = new JsonObject();
                observed.addProperty("id", actualId);
                observed.addProperty("version", actualVersion);
                JsonArray declaredMods = new JsonArray();
                JsonArray origins = new JsonArray();
                for (ModContainer loaded : FabricLoader.getInstance().getAllMods().stream()
                    .sorted((left, right) -> left.getMetadata().getId()
                        .compareTo(right.getMetadata().getId())).toList()) {
                    declaredMods.add(loaded.getMetadata().getId() + "@"
                        + loaded.getMetadata().getVersion().getFriendlyString());
                    if (loaded.getOrigin().getPaths().size() != 1
                        || !Files.isRegularFile(loaded.getOrigin().getPaths().getFirst())) {
                        return result("unavailable", "mod_origin_unavailable");
                    }
                    JsonObject origin = new JsonObject();
                    origin.addProperty("id", loaded.getMetadata().getId());
                    origin.addProperty("version",
                        loaded.getMetadata().getVersion().getFriendlyString());
                    origin.addProperty("origin",
                        loaded.getMetadata().getId().equals(productionMod().getMetadata().getId())
                            ? "production_jar" : "modpack_cache");
                    origin.addProperty("sha256",
                        sha256File(loaded.getOrigin().getPaths().getFirst()));
                    origins.add(origin);
                }
                observed.add("declaredMods", declaredMods);
                observed.add("loadedMods", origins);
                boolean compatible = actualId.equals(expected.get("id").getAsString())
                    && actualVersion.equals(expected.get("version").getAsString())
                    && declaredMods.equals(expected.getAsJsonArray("declaredMods"))
                    && origins.size() == declaredMods.size();
                observed.addProperty("compatible", compatible);
                boolean matched = actualId.equals(expected.get("id").getAsString())
                    && actualVersion.equals(expected.get("version").getAsString())
                    && declaredMods.equals(expected.getAsJsonArray("declaredMods"))
                    && compatible == expected.get("compatible").getAsBoolean();
                return productionResult(condition, observed, matched, client);
            }
            return result("unsupported", "assertion_unavailable");
        } catch (Exception error) {
            return result("unavailable", "observation_unavailable");
        }
    }

    private static JsonObject productionDefinition() {
        return scenario.has("production") ? scenario.getAsJsonObject("production") : null;
    }

    private static ModContainer productionMod() {
        JsonObject definition = productionDefinition();
        if (definition == null || !definition.has("modId")) return null;
        String modId = definition.get("modId").getAsString();
        if (!modId.matches("[a-z][a-z0-9_]*")) return null;
        return FabricLoader.getInstance().getModContainer(modId).orElse(null);
    }

    private static String expectedProductionState(String id) {
        JsonObject definition = productionDefinition();
        if (definition == null || !definition.has("states")) return null;
        JsonObject states = definition.getAsJsonObject("states");
        return states.has(id) ? states.get(id).getAsString() : null;
    }

    private static JsonObject productionState(Minecraft client, String id) {
        return client.player == null ? null : productionStateForPlayer(client.player, id);
    }

    private static JsonObject productionStateForPlayer(Player player, String id) {
        if (!id.matches("[a-z][a-z0-9_]*")) return null;
        ItemStack stack = player.getMainHandItem();
        if (stack.isEmpty()) return null;
        JsonObject observed = new JsonObject();
        observed.addProperty("id", id);
        observed.addProperty("state", "damage=" + stack.getDamageValue()
            + ";remaining=" + (stack.getMaxDamage() - stack.getDamageValue()));
        JsonObject oracle = new JsonObject();
        oracle.addProperty("kind", "item_durability");
        oracle.addProperty("item", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
        oracle.addProperty("damage", stack.getDamageValue());
        oracle.addProperty("remaining", stack.getMaxDamage() - stack.getDamageValue());
        observed.add("oracle", oracle);
        return observed;
    }

    private static JsonObject productionResult(String condition, JsonObject observed,
        boolean passed, Minecraft client) {
        JsonObject result = result(passed ? "passed" : "failed",
            passed ? null : "assertion_mismatch");
        result.addProperty("condition", condition);
        result.addProperty("passed", passed);
        result.add("observed", observed);
        result.addProperty("atTick", client.level == null ? -1 : client.level.getGameTime());
        return result;
    }

    private static String sha256File(Path path) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = Files.newInputStream(path)) {
            byte[] buffer = new byte[16_384];
            while (true) {
                int count = input.read(buffer);
                if (count < 0) break;
                digest.update(buffer, 0, count);
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static JsonObject assertOnClient(Minecraft client, JsonObject args) {
        String condition = args.get("condition").getAsString();
        if (condition.startsWith("production.")) {
            return productionAssertion(client, args, condition);
        }
        String[] parts = condition.trim().split("\\s+", 3);
        if (parts.length != 3) return result("unsupported", "assertion_unavailable");
        String left = parts[0];
        String operator = parts[1];
        String expected = parts[2];
        JsonPrimitive actual;
        if (left.equals("client.inWorld")) {
            actual = new JsonPrimitive(client.level != null);
        } else if (left.equals("player.mainHand") && client.player != null) {
            actual = new JsonPrimitive(BuiltInRegistries.ITEM.getKey(
                client.player.getMainHandItem().getItem()).toString());
        } else if (left.equals("player.inventory.contains") && client.player != null) {
            boolean found = false;
            for (ItemStack stack : client.player.getInventory().items) {
                if (BuiltInRegistries.ITEM.getKey(stack.getItem()).toString().equals(expected)) {
                    found = true;
                    break;
                }
            }
            actual = new JsonPrimitive(found);
        } else if (left.equals("player.health") && client.player != null) {
            actual = new JsonPrimitive(client.player.getHealth());
        } else if (left.equals("player.onGround") && client.player != null) {
            actual = new JsonPrimitive(client.player.onGround());
        } else if (left.startsWith("player.position.") && client.player != null) {
            actual = new JsonPrimitive(switch (left) {
                case "player.position.x" -> client.player.getX();
                case "player.position.y" -> client.player.getY();
                case "player.position.z" -> client.player.getZ();
                default -> throw new IllegalArgumentException("unknown position");
            });
        } else if (left.startsWith("block.at(") && client.level != null) {
            String[] coordinates = left.substring(9, left.length() - 1).split(",");
            BlockPos position = new BlockPos(Integer.parseInt(coordinates[0]),
                Integer.parseInt(coordinates[1]), Integer.parseInt(coordinates[2]));
            actual = new JsonPrimitive(BuiltInRegistries.BLOCK.getKey(
                client.level.getBlockState(position).getBlock()).toString());
        } else {
            return result("unavailable", "observed_state_unavailable");
        }

        boolean matched;
        if (actual.isBoolean()) {
            boolean expectedBoolean = left.equals("player.inventory.contains")
                || Boolean.parseBoolean(expected);
            matched = operator.equals("==") ? actual.getAsBoolean() == expectedBoolean
                : operator.equals("!=") && actual.getAsBoolean() != expectedBoolean;
        } else if (actual.isNumber()) {
            double leftNumber = actual.getAsDouble();
            double rightNumber = Double.parseDouble(expected);
            matched = switch (operator) {
                case "==" -> leftNumber == rightNumber;
                case "!=" -> leftNumber != rightNumber;
                case ">" -> leftNumber > rightNumber;
                case "<" -> leftNumber < rightNumber;
                case ">=" -> leftNumber >= rightNumber;
                case "<=" -> leftNumber <= rightNumber;
                default -> false;
            };
        } else {
            matched = operator.equals("==") ? actual.getAsString().equals(expected)
                : operator.equals("!=") && !actual.getAsString().equals(expected);
        }
        JsonObject result = result(matched ? "passed" : "failed",
            matched ? null : "assertion_mismatch");
        result.addProperty("condition", condition);
        result.addProperty("passed", matched);
        JsonObject observed = new JsonObject();
        observed.add("actual", actual);
        observed.addProperty("expected", expected);
        result.add("observed", observed);
        result.addProperty("atTick", client.level == null ? -1 : client.level.getGameTime());
        return result;
    }

    private static JsonObject captureScreenshot(Minecraft client, JsonObject args) {
        Path root = FabricLoader.getInstance().getGameDir()
            .resolve("voxellume-verification").resolve("screenshots").normalize();
        Path destination = root.resolve(args.get("path").getAsString()).normalize();
        if (!destination.startsWith(root) || !destination.getFileName().toString()
            .toLowerCase(java.util.Locale.ROOT).endsWith(".png")) {
            return result("failed", "path_escape");
        }
        try {
            Files.createDirectories(destination.getParent());
            try (NativeImage image = Screenshot.takeScreenshot(client.getMainRenderTarget())) {
                image.writeToFile(destination);
            }
            long byteLength = Files.size(destination);
            long maxBytes = args.get("maxBytes").getAsLong();
            if (byteLength > maxBytes || byteLength > ${MAX_SCREENSHOT_BYTES}) {
                return result("failed", "screenshot_too_large");
            }
            byte[] bytes = Files.readAllBytes(destination);
            String sha256 = HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(bytes));
            JsonObject result = result("passed", null);
            result.addProperty("path", root.relativize(destination).toString()
                .replace(destination.getFileSystem().getSeparator(), "/"));
            result.addProperty("byteLength", byteLength);
            result.addProperty("sha256", sha256);
            result.addProperty("capturedAtTick", client.level == null ? -1 : client.level.getGameTime());
            result.addProperty("width", client.getWindow().getWidth());
            result.addProperty("height", client.getWindow().getHeight());
            return result;
        } catch (Exception error) {
            return result("unavailable", "screenshot_unavailable");
        }
    }

    private static JsonObject result(String status, String code) {
        JsonObject result = new JsonObject();
        result.addProperty("status", status);
        if (code != null) result.addProperty("code", code);
        result.addProperty("instanceId", EXPECTED_INSTANCE_ID);
        result.addProperty("minecraftVersion", ACTUAL_MINECRAFT_VERSION);
        result.addProperty("loaderVersion", ACTUAL_LOADER_VERSION);
        return result;
    }

    private static String readBoundedLine(InputStream input) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        while (true) {
            int next = input.read();
            if (next == -1) return line.size() == 0 ? null : line.toString(StandardCharsets.UTF_8);
            if (next == '\\n') return line.toString(StandardCharsets.UTF_8);
            if (next != '\\r') line.write(next);
            if (line.size() > MAX_LINE_BYTES) throw new IOException("line_too_large");
        }
    }

    private static final class TickOperation {
        private final long startTick;
        private int remaining;
        private final boolean synchronize;
        private final KeyMapping release;
        private final CompletableFuture<JsonObject> future;

        private TickOperation(int ticks, long startTick, boolean synchronize,
            KeyMapping release, CompletableFuture<JsonObject> future) {
            this.startTick = startTick;
            this.remaining = ticks;
            this.synchronize = synchronize;
            this.release = release;
            this.future = future;
        }
    }

    private static final class WorldOperation {
        private final String name;
        private final String seed;
        private final CompletableFuture<JsonObject> future;

        private WorldOperation(String name, String seed, CompletableFuture<JsonObject> future) {
            this.name = name;
            this.seed = seed;
            this.future = future;
        }
    }
}
`;
}

function entrypointSource(): string {
  return `package dev.voxellume.verification.fabric;

import dev.voxellume.verification.VoxellumeVerificationBridge;
import net.fabricmc.api.ModInitializer;

public final class VoxellumeFabricVerificationMod implements ModInitializer {
    @Override
    public void onInitialize() {
        VoxellumeVerificationBridge.start();
    }
}
`;
}

export function generateVerificationMod(
  input: VerificationModGenerationInput,
): VerificationModGenerationResult {
  if (!supportedTarget(input.target)) {
    return {
      status: "unsupported",
      code: "unsupported_target",
      target: input.target,
    };
  }
  if (!validInstanceId(input.instanceId)) {
    return { status: "failed", code: "invalid_instance_id" };
  }
  if (
    input.token.trim() === "" ||
    input.token.length > 1_024 ||
    hasControlCharacters(input.token)
  ) {
    return { status: "failed", code: "unsafe_scenario", field: "token" };
  }
  const unsafeField = unsafeScenarioField(input.scenario);
  if (unsafeField !== undefined) {
    return { status: "failed", code: "unsafe_scenario", field: unsafeField };
  }

  const files: GeneratedVerificationModFile[] = [
    {
      outputPath:
        "src/test/java/dev/voxellume/verification/VoxellumeVerificationBridge.java",
      contents: Buffer.from(bridgeSource(input), "utf8"),
    },
    {
      outputPath:
        "src/test/java/dev/voxellume/verification/fabric/VoxellumeFabricVerificationMod.java",
      contents: Buffer.from(entrypointSource(), "utf8"),
    },
    {
      outputPath: "src/test/resources/fabric.mod.json",
      contents: jsonFile({
        schemaVersion: 1,
        id: "voxellume_verification",
        version: "1.0.0",
        name: "Voxellume Test-Only Verification",
        environment: "client",
        entrypoints: {
          main: [
            "dev.voxellume.verification.fabric.VoxellumeFabricVerificationMod",
          ],
        },
        depends: {
          minecraft: "1.21.1",
          fabricloader: "0.20.1",
          "fabric-api": "0.116.17+1.21.1",
          java: "21",
        },
      }),
    },
    {
      outputPath: "src/test/resources/voxellume-bridge.json",
      contents: jsonFile({
        schemaVersion: "voxellume-verification-bridge-1.0.0",
        protocol: "json-lines",
        host: "127.0.0.1",
        port: 0,
        token: input.token,
        maxLineBytes: MAX_LINE_BYTES,
        maxLines: MAX_LINES,
        allowedOperations: [
          "worldCreate",
          "settle",
          "input",
          "assert",
          "screenshot",
          "cancel",
          "cleanup",
        ],
      }),
    },
    {
      outputPath: "src/test/resources/voxellume-scenario.json",
      contents: jsonFile({
        schemaVersion: "voxellume-verification-scenario-1.0.0",
        instanceId: input.instanceId,
        target: { edition: "java", ...input.target },
        ...input.scenario,
      }),
    },
  ];
  files.sort((left, right) =>
    left.outputPath < right.outputPath
      ? -1
      : left.outputPath > right.outputPath
        ? 1
        : 0,
  );
  return { status: "generated", files };
}

const CAPABILITIES: RuntimeCapabilities = {
  launch: true,
  worldCreate: true,
  settle: true,
  realTicks: true,
  input: true,
  command: false,
  assert: true,
  screenshot: true,
  cancel: true,
  cleanup: true,
};

function failure(
  operation: RuntimeOperationName,
  status: "failed" | "unsupported" | "unavailable" | "cancelled" | "timed_out",
  code: string,
): RuntimeOperationResult<never> {
  return { status, code, adapter: "voxellume", operation };
}

function passed<T>(value: T): RuntimeOperationResult<T> {
  return { status: "passed", value };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validOwnedPids(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every(
      (pid) =>
        Number.isSafeInteger(pid) &&
        typeof pid === "number" &&
        pid > 0 &&
        pid !== process.pid,
    )
  );
}

function samePids(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((pid, index) => pid === right[index])
  );
}

function transportFailure(
  operation: RuntimeOperationName,
  error: unknown,
): RuntimeOperationResult<never> {
  const code = objectValue(error)?.code;
  if (
    code === "cancelled" ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return failure(operation, "cancelled", "cancelled");
  }
  if (code === "transport_timeout") {
    return failure(operation, "timed_out", "transport_timeout");
  }
  if (code === "tool_failed")
    return failure(operation, "failed", "tool_failed");
  return failure(
    operation,
    "unavailable",
    code === "request_too_large" ||
      code === "response_too_large" ||
      code === "authentication_failed"
      ? code
      : "transport_unavailable",
  );
}

export function createVerificationModAdapter(
  options: CreateVerificationModAdapterOptions,
): CreateVerificationModAdapterResult {
  if (!supportedTarget(options.target)) {
    return {
      status: "unsupported",
      code: "unsupported_target",
      target: options.target,
    };
  }
  if (!validInstanceId(options.instanceId)) {
    return { status: "unavailable", code: "invalid_instance_id" };
  }

  const sessions = new Map<string, RuntimeSession>();
  const pendingCalls = new Map<string, Set<AbortController>>();

  async function call(
    operation: RuntimeOperationName,
    sessionId: string | undefined,
    tool: string,
    args: Record<string, unknown>,
    deadlineMs?: number,
    timeoutMs?: number,
  ): Promise<RuntimeOperationResult<Record<string, unknown>>> {
    if (options.transport === undefined) {
      return failure(operation, "unavailable", "transport_required");
    }
    const approvedDeadline = deadlineMs ?? options.deadlineMs;
    const longRunning =
      operation === "worldCreate" ||
      operation === "settle" ||
      (operation === "input" && timeoutMs !== undefined);
    let remaining =
      timeoutMs ?? (longRunning ? 600_000 : DEFAULT_CALL_TIMEOUT_MS);
    if (approvedDeadline !== undefined) {
      if (!Number.isFinite(approvedDeadline)) {
        return failure(operation, "failed", "invalid_deadline");
      }
      const deadlineRemaining = Math.floor(approvedDeadline - Date.now());
      if (deadlineRemaining <= 0) {
        return failure(operation, "timed_out", "deadline_exceeded");
      }
      remaining = Math.min(remaining, deadlineRemaining);
    }
    if (!Number.isFinite(remaining) || remaining <= 0) {
      return failure(operation, "failed", "invalid_timeout");
    }

    const controller = new AbortController();
    let owned: Set<AbortController> | undefined;
    if (sessionId !== undefined) {
      owned = pendingCalls.get(sessionId);
      if (owned === undefined) {
        owned = new Set();
        pendingCalls.set(sessionId, owned);
      }
      owned.add(controller);
    }
    const callOptions: RuntimeCallOptions = {
      signal: controller.signal,
      timeoutMs: remaining,
    };
    try {
      const requestArgs =
        longRunning && approvedDeadline !== undefined
          ? { ...args, timeoutMs: remaining }
          : args;
      const response = objectValue(
        await options.transport.call(tool, requestArgs, callOptions),
      );
      if (
        response === undefined ||
        response.instanceId !== options.instanceId ||
        response.minecraftVersion !== options.target.minecraftVersion
      ) {
        return failure(operation, "failed", "identity_mismatch");
      }
      if (response.status === "accepted" || response.accepted === true) {
        return failure(operation, "unavailable", "observation_unavailable");
      }
      if (
        response.success === false ||
        response.matched === false ||
        response.passed === false ||
        response.status === "failed" ||
        response.status === "error" ||
        (typeof response.failed === "number" && response.failed > 0)
      ) {
        return failure(operation, "failed", `${operation}_failed`);
      }
      return passed(response);
    } catch (error) {
      return transportFailure(operation, error);
    } finally {
      owned?.delete(controller);
      if (owned?.size === 0) pendingCalls.delete(sessionId!);
    }
  }

  function trackedSession(
    operation: RuntimeOperationName,
    sessionId: string,
  ): RuntimeSession | RuntimeOperationResult<never> {
    return (
      sessions.get(sessionId) ?? failure(operation, "failed", "unknown_session")
    );
  }

  function exactPids(
    operation: RuntimeOperationName,
    input: RuntimeProcessInput,
  ): RuntimeSession | RuntimeOperationResult<never> {
    const session = trackedSession(operation, input.sessionId);
    if (!("id" in session)) return session;
    if (
      !validOwnedPids(input.ownedPids) ||
      !samePids(session.ownedPids, input.ownedPids)
    ) {
      return failure(operation, "failed", "unowned_pid");
    }
    return session;
  }

  async function launch(
    input: RuntimeLaunchInput,
  ): Promise<RuntimeOperationResult<RuntimeSession>> {
    if (
      !safeLabel(input.projectId) ||
      input.projectRoot.includes("\0") ||
      !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(input.projectRoot)
    ) {
      return failure("launch", "failed", "invalid_launch_input");
    }
    const response = await call(
      "launch",
      undefined,
      "voxellume.launch",
      {
        projectId: input.projectId,
        projectRoot: input.projectRoot,
        mode: input.mode,
        ...(input.javaHome === undefined ? {} : { javaHome: input.javaHome }),
      },
      input.deadlineMs,
    );
    if (response.status !== "passed") return response;
    const sessionId = response.value.sessionId;
    const ownedPids = response.value.ownedPids;
    if (!safeLabel(sessionId) || !validOwnedPids(ownedPids)) {
      return failure("launch", "failed", "launch_failed");
    }
    if (
      response.value.bridgeHost !== "127.0.0.1" ||
      !Number.isSafeInteger(response.value.bridgePort) ||
      (response.value.bridgePort as number) < 1 ||
      (response.value.bridgePort as number) > 65_535
    ) {
      return failure("launch", "unavailable", "bridge_endpoint_unavailable");
    }
    if (sessions.has(sessionId)) {
      return failure("launch", "failed", "session_already_launched");
    }
    const session = { id: sessionId, ownedPids: [...ownedPids] };
    sessions.set(sessionId, session);
    return passed(session);
  }

  async function worldCreate(
    input: RuntimeWorldCreateInput,
  ): Promise<RuntimeOperationResult<unknown>> {
    const session = trackedSession("worldCreate", input.sessionId);
    if (!("id" in session)) return session;
    if (!safeLabel(input.name) || !safeLabel(input.seed)) {
      return failure("worldCreate", "failed", "invalid_world_input");
    }
    const response = await call(
      "worldCreate",
      input.sessionId,
      "voxellume.world.create",
      {
        sessionId: input.sessionId,
        name: input.name,
        seed: input.seed,
        isolated: true,
      },
      input.deadlineMs,
    );
    if (
      response.status === "passed" &&
      (response.value.worldName !== input.name ||
        response.value.seed !== input.seed ||
        response.value.isolated !== true ||
        !Number.isSafeInteger(response.value.startedAtTick))
    ) {
      return failure("worldCreate", "unavailable", "observation_unavailable");
    }
    return response;
  }

  async function settle(
    input: RuntimeSettleInput,
  ): Promise<RuntimeOperationResult<unknown>> {
    const session = trackedSession("settle", input.sessionId);
    if (!("id" in session)) return session;
    if (
      input.ticks === undefined ||
      !Number.isSafeInteger(input.ticks) ||
      input.ticks < 1
    ) {
      return failure("settle", "failed", "invalid_ticks");
    }
    const requiredTimeoutMs = input.ticks * 50 + 5_000;
    const approvedDeadline = input.deadlineMs ?? options.deadlineMs;
    if (approvedDeadline !== undefined && !Number.isFinite(approvedDeadline)) {
      return failure("settle", "failed", "invalid_deadline");
    }
    const remainingMs =
      approvedDeadline === undefined
        ? requiredTimeoutMs
        : Math.floor(approvedDeadline - Date.now());
    if (
      requiredTimeoutMs > 600_000 ||
      (approvedDeadline !== undefined && remainingMs < requiredTimeoutMs)
    ) {
      return failure("settle", "failed", "unsatisfiable_deadline");
    }
    const response = await call(
      "settle",
      input.sessionId,
      "voxellume.ticks.wait",
      {
        sessionId: input.sessionId,
        ticks: input.ticks,
        synchronize: input.synchronize ?? false,
      },
      input.deadlineMs,
      requiredTimeoutMs,
    );
    if (
      response.status === "passed" &&
      (!Number.isSafeInteger(response.value.startTick) ||
        !Number.isSafeInteger(response.value.endTick) ||
        (response.value.endTick as number) -
          (response.value.startTick as number) !==
          input.ticks ||
        (input.synchronize === true
          ? response.value.synchronized !== true
          : response.value.synchronized !== undefined &&
            response.value.synchronized !== false))
    ) {
      return failure("settle", "unavailable", "observation_unavailable");
    }
    return response;
  }

  async function input(
    runtimeInput: RuntimeInput,
  ): Promise<RuntimeOperationResult<unknown>> {
    const session = trackedSession("input", runtimeInput.sessionId);
    if (!("id" in session)) return session;
    const action = runtimeInput.action;
    if (
      action.kind !== "key" ||
      action.key !== "W" ||
      action.holdMs !== undefined ||
      (action.modifiers !== undefined && action.modifiers.length > 0) ||
      (action.action === "hold" && action.holdTicks === undefined)
    ) {
      return failure("input", "unsupported", "input_unavailable");
    }
    const requiredTimeoutMs =
      action.kind === "key" &&
      action.action === "hold" &&
      action.holdTicks !== undefined
        ? action.holdTicks * 50 + 5_000
        : undefined;
    const approvedDeadline = runtimeInput.deadlineMs ?? options.deadlineMs;
    if (approvedDeadline !== undefined && !Number.isFinite(approvedDeadline)) {
      return failure("input", "failed", "invalid_deadline");
    }
    if (
      requiredTimeoutMs !== undefined &&
      (requiredTimeoutMs > 600_000 ||
        (approvedDeadline !== undefined &&
          Math.floor(approvedDeadline - Date.now()) < requiredTimeoutMs))
    ) {
      return failure("input", "failed", "unsatisfiable_deadline");
    }
    if (!validAction(action)) return failure("input", "failed", "unsafe_input");
    const response = await call(
      "input",
      runtimeInput.sessionId,
      "voxellume.input",
      { sessionId: runtimeInput.sessionId, action },
      runtimeInput.deadlineMs,
      requiredTimeoutMs,
    );
    if (
      response.status === "passed" &&
      (JSON.stringify(response.value.appliedAction) !==
        JSON.stringify(action) ||
        !Number.isSafeInteger(response.value.atTick))
    ) {
      return failure("input", "unavailable", "observation_unavailable");
    }
    return response;
  }

  async function command(): Promise<RuntimeOperationResult<unknown>> {
    return failure("command", "unsupported", "command_not_allowed");
  }

  async function assert(
    assertion: RuntimeAssertInput,
  ): Promise<RuntimeOperationResult<unknown>> {
    const session = trackedSession("assert", assertion.sessionId);
    if (!("id" in session)) return session;
    if (
      assertion.condition === undefined ||
      assertion.scenarioPath !== undefined ||
      !supportedAssertionCondition(assertion.condition)
    ) {
      return failure("assert", "unsupported", "assertion_unavailable");
    }
    const response = await call(
      "assert",
      assertion.sessionId,
      "voxellume.assert",
      {
        sessionId: assertion.sessionId,
        condition: assertion.condition,
        ...(assertion.timeoutMs === undefined
          ? {}
          : { timeoutMs: assertion.timeoutMs }),
      },
      assertion.deadlineMs,
      assertion.timeoutMs,
    );
    if (
      response.status === "passed" &&
      (response.value.condition !== assertion.condition ||
        response.value.passed !== true ||
        objectValue(response.value.observed) === undefined ||
        !Number.isSafeInteger(response.value.atTick))
    ) {
      return failure("assert", "unavailable", "observation_unavailable");
    }
    if (
      response.status === "passed" &&
      assertion.condition.startsWith("production.")
    ) {
      const matches = matchesProductionObservation(
        options.scenario,
        assertion.condition,
        assertion.sessionId,
        response.value.observed,
      );
      if (matches === undefined) {
        return failure("assert", "unavailable", "observation_unavailable");
      }
      if (!matches) return failure("assert", "failed", "assertion_mismatch");
    }
    return response;
  }

  async function screenshot(
    screenshotInput: RuntimeScreenshotInput,
  ): Promise<
    RuntimeOperationResult<RuntimeScreenshot | Record<string, never>>
  > {
    const session = trackedSession("screenshot", screenshotInput.sessionId);
    if (!("id" in session)) return session;
    if (
      !safeRelativePath(screenshotInput.path) ||
      !Number.isSafeInteger(screenshotInput.maxBytes) ||
      screenshotInput.maxBytes < 1 ||
      screenshotInput.maxBytes > MAX_SCREENSHOT_BYTES
    ) {
      return failure("screenshot", "failed", "invalid_screenshot_input");
    }
    const response = await call(
      "screenshot",
      screenshotInput.sessionId,
      "voxellume.screenshot",
      {
        sessionId: screenshotInput.sessionId,
        path: screenshotInput.path,
        maxBytes: screenshotInput.maxBytes,
      },
      screenshotInput.deadlineMs,
    );
    if (response.status !== "passed") return response;
    const { path, byteLength, sha256 } = response.value;
    if (
      path !== screenshotInput.path ||
      !Number.isSafeInteger(byteLength) ||
      typeof byteLength !== "number" ||
      byteLength < 1 ||
      byteLength > screenshotInput.maxBytes ||
      typeof sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(sha256) ||
      !Number.isSafeInteger(response.value.capturedAtTick) ||
      !Number.isSafeInteger(response.value.width) ||
      !Number.isSafeInteger(response.value.height) ||
      (response.value.width as number) < 1 ||
      (response.value.height as number) < 1
    ) {
      return failure("screenshot", "unavailable", "observation_unavailable");
    }
    return passed(response.value as unknown as RuntimeScreenshot);
  }

  async function cancel(
    cancelInput: RuntimeProcessInput,
  ): Promise<RuntimeOperationResult<unknown>> {
    const session = exactPids("cancel", cancelInput);
    if (!("id" in session)) return session;
    for (const controller of pendingCalls.get(cancelInput.sessionId) ?? []) {
      controller.abort();
    }
    const response = await call(
      "cancel",
      cancelInput.sessionId,
      "voxellume.cancel",
      {
        sessionId: cancelInput.sessionId,
        ownedPids: [...cancelInput.ownedPids],
      },
      cancelInput.deadlineMs,
    );
    if (
      response.status === "passed" &&
      (response.value.cancelled !== true ||
        !Number.isSafeInteger(response.value.cancelledAtTick))
    ) {
      return failure("cancel", "unavailable", "observation_unavailable");
    }
    return response;
  }

  async function cleanup(
    cleanupInput: RuntimeProcessInput,
  ): Promise<RuntimeOperationResult<unknown>> {
    const session = exactPids("cleanup", cleanupInput);
    if (!("id" in session)) return session;
    if (options.launcher === undefined) {
      return failure("cleanup", "unavailable", "observation_unavailable");
    }
    const response = await call(
      "cleanup",
      cleanupInput.sessionId,
      "voxellume.cleanup",
      {
        sessionId: cleanupInput.sessionId,
        ownedPids: [...cleanupInput.ownedPids],
      },
      cleanupInput.deadlineMs,
    );
    if (response.status !== "passed") return response;
    let termination: {
      readonly terminatedOwnedPids: readonly number[];
      readonly remainingOwnedPids: readonly number[];
    };
    try {
      termination = await options.launcher.terminateOwnedPids([
        ...cleanupInput.ownedPids,
      ]);
    } catch {
      return failure("cleanup", "failed", "cleanup_failed");
    }
    if (
      !samePids(cleanupInput.ownedPids, termination.terminatedOwnedPids) ||
      termination.remainingOwnedPids.length !== 0
    ) {
      return failure("cleanup", "unavailable", "observation_unavailable");
    }
    sessions.delete(cleanupInput.sessionId);
    pendingCalls.delete(cleanupInput.sessionId);
    return passed({
      instanceId: options.instanceId,
      minecraftVersion: options.target.minecraftVersion,
      terminatedOwnedPids: [...termination.terminatedOwnedPids],
      remainingOwnedPids: [...termination.remainingOwnedPids],
    });
  }

  const adapter: RuntimeAdapter = {
    id: "voxellume",
    revision: "voxellume-verification-mod",
    target: options.target,
    capabilities: CAPABILITIES,
    launch,
    worldCreate,
    settle,
    input,
    command,
    assert,
    screenshot,
    cancel,
    cleanup,
  };
  return { status: "available", adapter };
}
