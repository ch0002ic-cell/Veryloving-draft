//
//  CompanionAudioService.swift
//  Veryloving
//
//  Ported from emo_ios AudioService. Captures microphone audio as 16-bit/48kHz
//  linear PCM (base64) for Hume EVI and plays back streamed audio responses.
//  Retains the prototype's simulator fallback (synthetic audio when the
//  simulator microphone is unavailable).
//

import Foundation
import AVFoundation

enum CompanionAudioError: LocalizedError {
    case engineStartFailed
    case invalidData

    var errorDescription: String? {
        switch self {
        case .engineStartFailed: return "Couldn't start the microphone."
        case .invalidData: return "Received invalid audio data."
        }
    }
}

final class CompanionAudioService: NSObject, CompanionAudioProtocol, AVAudioPlayerDelegate {

    weak var delegate: CompanionAudioDelegate?
    private(set) var isRunning = false
    var isMuted = false

    private var audioEngine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    private let audioSession = AVAudioSession.sharedInstance()

    private var isSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    private var audioTimer: Timer?
    private var audioPlaybackQueue: [URL] = []
    private var isAudioPlaying = false
    private var currentAudioPlayer: AVAudioPlayer?
    private var nativeInputFormat: AVAudioFormat?

    override init() {
        super.init()
        audioEngine = AVAudioEngine()
        inputNode = audioEngine?.inputNode

        if isSimulator {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.setupAudioSession()
                self.setupAudioEngine()
            }
        } else {
            setupAudioSession()
            setupAudioEngine()
        }
    }

    // MARK: Public

    func start() throws {
        guard !isRunning else { return }
        guard let audioEngine else { throw CompanionAudioError.engineStartFailed }

        if isSimulator {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.attemptRealAudioStart() }
            return
        }
        do {
            try audioEngine.start()
            startRecording()
            isRunning = true
        } catch {
            throw CompanionAudioError.engineStartFailed
        }
    }

    func stop() {
        guard isRunning else { return }
        audioTimer?.invalidate(); audioTimer = nil
        inputNode?.removeTap(onBus: 0)
        audioEngine?.stop()
        handleInterruption()
        isRunning = false
    }

    func handleInterruption() {
        currentAudioPlayer?.stop()
        currentAudioPlayer = nil
        audioPlaybackQueue.forEach { cleanupFile(at: $0) }
        audioPlaybackQueue.removeAll()
        isAudioPlaying = false
    }

    func playAudio(_ base64Data: String) {
        guard let audioData = Data(base64Encoded: base64Data) else {
            delegate?.audio(self, didEncounterError: CompanionAudioError.invalidData)
            return
        }
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
        do {
            try audioData.write(to: fileURL)
            audioPlaybackQueue.append(fileURL)
            processAudioPlaybackQueue()
        } catch {
            delegate?.audio(self, didEncounterError: error)
        }
    }

    // MARK: Setup

    private func setupAudioEngine() {
        guard let audioEngine, let inputNode else { return }
        if let inputFormat = nativeInputFormat {
            audioEngine.connect(inputNode, to: audioEngine.mainMixerNode, format: inputFormat)
        }
        audioEngine.prepare()
    }

    private func setupAudioSession() {
        guard let inputNode else { return }
        do {
            if isSimulator {
                try audioSession.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers])
                try audioSession.setPreferredSampleRate(48000)
                try audioSession.setPreferredInputNumberOfChannels(1)
            } else {
                try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            }
            try audioSession.setActive(true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.nativeInputFormat = inputNode.inputFormat(forBus: 0)
            }
        } catch {
            AppLogger.chat.error("Audio session setup failed: \(error.localizedDescription)")
        }
    }

    private func attemptRealAudioStart() {
        guard let audioEngine else {
            startSimulatorAudio(); isRunning = true; return
        }
        do {
            try audioEngine.start()
            startRecording()
            isRunning = true
        } catch {
            AppLogger.chat.info("Simulator mic unavailable — using synthetic audio.")
            startSimulatorAudio()
            isRunning = true
        }
    }

    private func startRecording() {
        guard let inputNode else { return }
        inputNode.removeTap(onBus: 0)
        guard let inputFormat = nativeInputFormat else {
            delegate?.audio(self, didEncounterError: CompanionAudioError.engineStartFailed)
            return
        }
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            guard let self, !self.isMuted else { return }
            let data = self.convertToEVIFormat(buffer)
            self.delegate?.audio(self, didCapture: data.base64EncodedString())
        }
    }

    private func startSimulatorAudio() {
        audioTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] timer in
            guard let self, self.isRunning else { timer.invalidate(); return }
            guard !self.isMuted else { return }
            let sampleRate = 48000.0, duration = 0.1
            let frameCount = Int(sampleRate * duration)
            var audioData = Data()
            for i in 0..<frameCount {
                let time = Double(i) / sampleRate
                let amplitude = sin(2.0 * Double.pi * 440.0 * time) * 0.1
                let sample = Int16(amplitude * 32767.0)
                withUnsafeBytes(of: sample.littleEndian) { audioData.append(contentsOf: $0) }
            }
            self.delegate?.audio(self, didCapture: audioData.base64EncodedString())
        }
    }

    private func convertToEVIFormat(_ buffer: AVAudioPCMBuffer) -> Data {
        guard let floatData = buffer.floatChannelData?[0] else { return Data() }
        let frameLength = Int(buffer.frameLength)
        let inputSampleRate = buffer.format.sampleRate
        let targetSampleRate = 48000.0
        var outputFrames: [Int16] = []

        if inputSampleRate == targetSampleRate {
            for frame in 0..<frameLength {
                let scaled = max(-1.0, min(floatData[frame], 1.0)) * 32767.0
                outputFrames.append(Int16(scaled))
            }
        } else {
            let ratio = inputSampleRate / targetSampleRate
            let outputLength = Int(Double(frameLength) / ratio)
            for i in 0..<outputLength {
                let inputIndex = Double(i) * ratio
                let lower = Int(inputIndex)
                let upper = min(lower + 1, frameLength - 1)
                let fraction = Float(inputIndex - Double(lower))
                let interpolated = floatData[lower] + fraction * (floatData[upper] - floatData[lower])
                let scaled = max(-1.0, min(interpolated, 1.0)) * 32767.0
                outputFrames.append(Int16(scaled))
            }
        }
        return Data(bytes: outputFrames, count: outputFrames.count * 2)
    }

    private func processAudioPlaybackQueue() {
        guard !isAudioPlaying, !audioPlaybackQueue.isEmpty else { return }
        let fileToPlay = audioPlaybackQueue.removeFirst()
        do {
            let player = try AVAudioPlayer(contentsOf: fileToPlay)
            player.delegate = self
            isAudioPlaying = true
            player.prepareToPlay()
            player.play()
            currentAudioPlayer = player
        } catch {
            cleanupFile(at: fileToPlay)
            delegate?.audio(self, didEncounterError: error)
            isAudioPlaying = false
            processAudioPlaybackQueue()
        }
    }

    private func cleanupFile(at url: URL) {
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: AVAudioPlayerDelegate

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        if let url = currentAudioPlayer?.url { cleanupFile(at: url) }
        currentAudioPlayer = nil
        isAudioPlaying = false
        DispatchQueue.main.async { [weak self] in self?.processAudioPlaybackQueue() }
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        if let error { delegate?.audio(self, didEncounterError: error) }
        if let url = currentAudioPlayer?.url { cleanupFile(at: url) }
        currentAudioPlayer = nil
        isAudioPlaying = false
        DispatchQueue.main.async { [weak self] in self?.processAudioPlaybackQueue() }
    }
}
