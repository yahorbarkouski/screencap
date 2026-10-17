import AppKit
import Carbon
import ScreencapCore
import ServiceManagement
import SwiftUI

/// Only what operating capture, the models and the backup needs.
struct SettingsView: View {
  let model: AppModel
  var onChange: () -> Void
  @State private var settings: ScreencapCore.Settings
  @State private var key = ""
  @State private var hasKey = OpenRouter.storedKey() != nil
  @State private var backupSecret = ""
  @State private var newExclusion = ""
  @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
  @State private var recoveryMessage: String?
  @State private var recoveryText = ""
  @State private var hasBackupKey = (try? BackupKeyStore.load()) != nil
  @State private var hasBackupSecret = Keychain.read(.backupSecretKey) != nil
  @State private var checkMessage: String?
  @State private var isChecking = false
  @State private var keyMessage: String?
  @State private var shownRecoveryKey: String?

  init(model: AppModel, onChange: @escaping () -> Void) {
    self.model = model
    self.onChange = onChange
    _settings = State(initialValue: model.settings.current)
  }

  var body: some View {
    Form {
      Section("Appearance") {
        Picker("Theme", selection: $settings.appearance) {
          ForEach(Appearance.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)
        Toggle("Show site icons", isOn: $settings.fetchesSiteIcons)
        Text("Each site's icon is fetched once from the site itself, so that site sees one request from your Mac. Off shows the browser's icon.")
          .font(.caption).foregroundStyle(.secondary)
      }
      Section("Understanding") {
        HStack {
          SecureField(hasKey ? "OpenRouter key saved in the Keychain" : "OpenRouter API key", text: $key)
          Button("Save") {
            guard !key.isEmpty else { return }
            guard Keychain.write(Data(key.utf8), for: .openRouterKey) else {
              keyMessage = "The Keychain refused the key; nothing was saved."
              return
            }
            key = ""
            hasKey = true
            keyMessage = nil
            onChange()
          }
          .disabled(key.isEmpty)
        }
        if let keyMessage { Text(keyMessage).font(.caption).foregroundStyle(.red) }
        Text("Screencap uses this key to sort your day into activities and threads with AI models through OpenRouter. Every request uses zero data retention: OpenRouter and the models keep no copy and never train on it, unless you turn on logging in your OpenRouter account.")
          .font(.caption).foregroundStyle(.secondary)
        Toggle("Text-only mode: send no screenshots to the models", isOn: $settings.textOnlyMode)
        Text("Window titles, sites and screen text still go to OpenRouter, with keys and card numbers masked. Screenshots improve activity boundaries by a few points.")
          .font(.caption).foregroundStyle(.secondary)
        if let problem = model.understanding?.lastError {
          Text("Last problem: \(problem)").font(.caption).foregroundStyle(.red)
        }
      }
      Section("Capture") {
        Toggle("Open at login", isOn: $launchAtLogin)
          .onChange(of: launchAtLogin) { _, enabled in
            do { if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } } catch {
              launchAtLogin = SMAppService.mainApp.status == .enabled
            }
          }
        LabeledContent("Never capture", value: "Password managers and their web vaults, private browser windows")
        Text("Screencap knows the common password managers. If yours is missing, add it here.")
          .font(.caption).foregroundStyle(.secondary)
        ForEach(settings.excludedBundleIDs, id: \.self) { bundleID in
          HStack {
            Text(bundleID)
            Spacer()
            Button("Remove") { settings.excludedBundleIDs.removeAll { $0 == bundleID } }
          }
        }
        HStack {
          Picker("Exclude an app", selection: $newExclusion) {
            Text("Choose a running app").tag("")
            ForEach(runningApps, id: \.self) { Text($0).tag($0) }
          }
          Button("Add") {
            if !newExclusion.isEmpty, !settings.excludedBundleIDs.contains(newExclusion) { settings.excludedBundleIDs.append(newExclusion) }
            newExclusion = ""
          }
          .disabled(newExclusion.isEmpty)
        }
      }
      AgentsSection(access: $settings.agents, location: model.location)
      Section("Backup") {
        Toggle("Back up to your own storage", isOn: $settings.backup.isEnabled)
        Picker("Provider", selection: $settings.backup.provider) {
          ForEach(BackupProvider.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }
        switch settings.backup.provider {
        case .amazonS3:
          TextField("Region", text: $settings.backup.region, prompt: Text("eu-central-1"))
        case .cloudflareR2:
          TextField("Account ID", text: $settings.backup.accountID, prompt: Text("From the R2 overview page"))
        case .backblazeB2:
          TextField("Region", text: $settings.backup.region, prompt: Text("us-west-004"))
        case .other:
          TextField("Endpoint", text: $settings.backup.endpoint, prompt: Text("https://s3.example.com"))
          TextField("Region", text: $settings.backup.region, prompt: Text("us-east-1"))
        }
        TextField("Bucket", text: $settings.backup.bucket)
        TextField("Access key ID", text: $settings.backup.accessKeyID)
        HStack {
          SecureField(hasBackupSecret ? "Secret saved in the Keychain" : "Secret access key", text: $backupSecret)
          Button("Save") {
            guard Keychain.write(Data(backupSecret.utf8), for: .backupSecretKey) else {
              checkMessage = "The Keychain refused the secret; nothing was saved."
              return
            }
            backupSecret = ""
            hasBackupSecret = true
          }
          .disabled(backupSecret.isEmpty)
        }
        HStack {
          Button(isChecking ? "Checking…" : "Check connection") {
            isChecking = true
            let backup = settings.backup
            Task {
              checkMessage = await BackupDriver.check(backup)
              isChecking = false
            }
          }
          .disabled(isChecking)
          if let checkMessage { Text(checkMessage).font(.caption).foregroundStyle(.secondary) }
        }
        if hasBackupKey {
          if let shownRecoveryKey {
            Text(shownRecoveryKey).font(.system(.body, design: .monospaced)).textSelection(.enabled)
            HStack {
              Button("Copy") { copyConcealed(shownRecoveryKey) }
              Button("Hide") { self.shownRecoveryKey = nil }
            }
          } else {
            Button("Show recovery key") { showRecoveryKey() }
          }
        } else {
          HStack {
            SecureField("Recovery key of an existing backup", text: $recoveryText)
            Button("Use") { useRecoveryKey() }.disabled(BackupKey(recoveryText: recoveryText) == nil)
          }
        }
        if let recoveryMessage { Text(recoveryMessage).font(.caption).foregroundStyle(.secondary) }
        Text(
          "Screenshots and history are encrypted on this Mac before upload, so the provider sees only object names, which carry dates, their sizes and upload times. The first backup into an empty bucket makes the key. Copy its recovery key into your password manager: another Mac needs it to read or continue the backup, and without it nobody can read the backup."
        )
        .font(.caption).foregroundStyle(.secondary)
        if let problem = model.backup?.lastError {
          Text("Last problem: \(problem)").font(.caption).foregroundStyle(.red)
        } else if settings.backup.isEnabled, let last = model.backup?.lastBackup {
          Text("Up to date as of \(last.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary)
        }
      }
      ResumeSection(database: model.database, location: model.location, resume: $settings.resume)
      if let updates = model.updates { UpdatesSection(updates: updates) }
    }
    .formStyle(.grouped)
    .frame(minWidth: 520, maxWidth: .infinity, minHeight: 420, maxHeight: .infinity)
    .onChange(of: settings) { _, value in
      model.settings.update { $0 = value }
      onChange()
    }
  }

  var runningApps: [String] {
    NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.compactMap(\.bundleIdentifier).sorted()
  }

  /// Shows the recovery key in this window, which Screencap never captures. It is never written to a file, which a
  /// synced folder could copy.
  func showRecoveryKey() {
    do {
      shownRecoveryKey = try BackupKeyStore.load()?.recoveryText
    } catch {
      recoveryMessage = String(describing: error)
    }
  }

  /// Copies text marked concealed, so clipboard managers that honour the mark keep no copy.
  func copyConcealed(_ text: String) {
    let pasteboard = NSPasteboard.general
    let concealed = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")
    pasteboard.declareTypes([.string, concealed], owner: nil)
    pasteboard.setString(text, forType: .string)
    pasteboard.setString("", forType: concealed)
    recoveryMessage = "Copied. Paste it into your password manager."
  }

  /// Keeps backing up into a bucket made on another Mac, with the key it was sealed with.
  func useRecoveryKey() {
    guard let key = BackupKey(recoveryText: recoveryText) else { return }
    do {
      try BackupKeyStore.save(key)
      recoveryText = ""
      hasBackupKey = true
      recoveryMessage = "Saved in the Keychain."
    } catch {
      recoveryMessage = String(describing: error)
    }
  }
}

/// Sparkle's two switches, the running version and a way to check now.
/// Resume: what opens it, and which browsers it may ask about their tabs.
struct ResumeSection: View {
  let database: AppDatabase
  let location: StoreLocation
  @Binding var resume: ResumeSettings
  @State private var recording = false
  @State private var keyMonitor: Any?
  @State private var recordingHint: String?
  @State private var excluded: [ThingExclusion] = []
  @State private var automation = AutomationAccess.summary()
  @State private var asking = false
  @State private var rebuilt: String?

  var body: some View {
    Section("Resume") {
      Toggle("Jump back into a thread", isOn: $resume.isEnabled)
      if resume.isEnabled {
        details
      } else {
        Text("Off, the shortcut opens nothing and Screencap stops working out the places of each thread.")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
    .onAppear { excluded = (try? database.excludedPlaces()) ?? [] }
    .onDisappear { stopRecording() }
  }

  @ViewBuilder private var details: some View {
    HStack {
      Text("Shortcut")
      Spacer()
      if resume.shortcut != nil, !recording {
        Button("Use ⌥Space") { resume.shortcut = nil }
          .buttonStyle(.borderless)
      }
      Button(recording ? "Type the shortcut…" : ResumePaletteController.shortcutName) {
        recording ? stopRecording() : startRecording()
      }
      .font(.mono(12))
    }
    if let note = recordingHint ?? ResumeShortcut.shared.problem {
      Text(note).font(.caption).foregroundStyle(.orange)
    }
    HStack {
      Text(automation).font(.caption).foregroundStyle(.secondary)
      Spacer()
      if AutomationAccess.anyUnasked() {
        Button(asking ? "Asking…" : "Ask") {
          asking = true
          Task {
            let states = await AutomationAccess.request()
            automation = AutomationAccess.outcome(of: states)
            asking = false
          }
        }
        .disabled(asking)
      } else {
        Button("Open Settings") { AutomationAccess.openSettings() }
      }
    }
    Text(
      "To put you back on the right page, Screencap asks your browser which tabs are open. Without that it can"
        + " only bring the browser's window forward."
    )
    .font(.caption).foregroundStyle(.secondary)
    HStack {
      Text(rebuilt ?? "Places are worked out again every ten minutes.").font(.caption).foregroundStyle(.secondary)
      Spacer()
      Button("Rebuild now") {
        rebuilt = "Working…"
        let database = database
        let cache = location.claudeSessionCache
        Task.detached(priority: .utility) {
          let sessions = ClaudeSessionIndex.build(cache: cache)
          let report = try? BindingBuilder().rebuild(
            in: database, readers: ThingReaders.standard(sessions: sessions))
          let said = report.map { "\($0.things) places in \($0.threads) threads." } ?? "Could not rebuild."
          await MainActor.run { rebuilt = said }
        }
      }
    }
    if !excluded.isEmpty {
      DisclosureGroup("Places taken out of threads (\(excluded.count))") {
        ForEach(excluded) { item in
          HStack {
            VStack(alignment: .leading, spacing: 1) {
              Text(item.thing.label).lineLimit(1).truncationMode(.middle)
              Text("Out of \(item.threadName)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Button("Put back") {
              guard let thingID = item.thing.id else { return }
              try? database.include(thingID: thingID, inThread: item.threadID)
              excluded = (try? database.excludedPlaces()) ?? []
            }
          }
        }
      }
    }
  }

  /// Takes the next key press in this window as the new shortcut. The current one is let go meanwhile, so it can be
  /// typed without opening the palette; escape leaves things as they were.
  private func startRecording() {
    recording = true
    recordingHint = nil
    ResumeShortcut.shared.pause(true)
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
      MainActor.assumeIsolated {
        let bare = event.modifierFlags.intersection([.command, .option, .control, .shift]).isEmpty
        if bare, Int(event.keyCode) == kVK_Escape {
          stopRecording()
        } else if let shortcut = Shortcut(event: event) {
          resume.shortcut = shortcut == .optionSpace ? nil : shortcut
          stopRecording()
        } else {
          recordingHint = "Hold ⌘, ⌥ or ⌃ with the key, or press escape to keep the shortcut you have."
        }
      }
      return nil
    }
  }

  private func stopRecording() {
    guard recording else { return }
    if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
    keyMonitor = nil
    recording = false
    recordingHint = nil
    ResumeShortcut.shared.pause(false)
  }
}

struct UpdatesSection: View {
  @Bindable var updates: Updates

  var body: some View {
    Section("Updates") {
      Toggle("Check for updates automatically", isOn: $updates.automaticallyChecks)
      Toggle("Download and install updates automatically", isOn: $updates.automaticallyInstalls)
        .disabled(!updates.automaticallyChecks)
      HStack {
        Text("Screencap \(Updates.currentVersion)")
        Spacer()
        Button(updates.actionTitle ?? "Check Now") { updates.checkOrInstall() }
          .disabled(updates.actionTitle == nil && !updates.canCheck)
      }
      Text(caption).font(.caption).foregroundStyle(.secondary)
    }
  }

  var caption: String {
    if case .ready = updates.state {
      return "The update installs the next time your screen locks, or when you quit Screencap."
    }
    let installs = updates.automaticallyInstalls && updates.automaticallyChecks
      ? "Updates install while your screen is locked." : "Screencap asks before it installs an update."
    guard let last = updates.lastCheck else { return installs }
    return "\(installs) Last checked \(last.formatted(.relative(presentation: .named)))."
  }
}
