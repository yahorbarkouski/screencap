import AVFoundation
import AudioToolbox
import SwiftUI
import UIKit

struct QRCodeScannerView: UIViewControllerRepresentable {
	let onCode: (String) -> Void

	func makeCoordinator() -> Coordinator {
		Coordinator(onCode: onCode)
	}

	func makeUIViewController(context: Context) -> ScannerViewController {
		let controller = ScannerViewController()
		controller.delegate = context.coordinator
		return controller
	}

	func updateUIViewController(_: ScannerViewController, context _: Context) {}

	final class Coordinator: NSObject, ScannerViewControllerDelegate {
		private let onCode: (String) -> Void

		init(onCode: @escaping (String) -> Void) {
			self.onCode = onCode
		}

		func scannerViewController(_ controller: ScannerViewController, didCapture code: String) {
			onCode(code)
		}
	}
}

protocol ScannerViewControllerDelegate: AnyObject {
	func scannerViewController(_ controller: ScannerViewController, didCapture code: String)
}

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
	weak var delegate: ScannerViewControllerDelegate?
	private let session = AVCaptureSession()
	private var previewLayer: AVCaptureVideoPreviewLayer?
	private let messageLabel = UILabel()
	private var didEmitCode = false

	override func viewDidLoad() {
		super.viewDidLoad()
		view.backgroundColor = .black
		configureMessageLabel()
		configureSession()
	}

	override func viewDidLayoutSubviews() {
		super.viewDidLayoutSubviews()
		previewLayer?.frame = view.bounds
	}

	override func viewWillAppear(_ animated: Bool) {
		super.viewWillAppear(animated)
		if !session.isRunning {
			session.startRunning()
		}
	}

	override func viewWillDisappear(_ animated: Bool) {
		super.viewWillDisappear(animated)
		if session.isRunning {
			session.stopRunning()
		}
	}

	func metadataOutput(
		_: AVCaptureMetadataOutput,
		didOutput metadataObjects: [AVMetadataObject],
		from _: AVCaptureConnection
	) {
		guard !didEmitCode else { return }
		guard
			let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
			let value = object.stringValue
		else {
			return
		}

		didEmitCode = true
		AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
		session.stopRunning()
		delegate?.scannerViewController(self, didCapture: value)
	}

	private func configureMessageLabel() {
		messageLabel.translatesAutoresizingMaskIntoConstraints = false
		messageLabel.text = "Scan the pairing QR from your Mac"
		messageLabel.textColor = .white
		messageLabel.font = .systemFont(ofSize: 17, weight: .medium)
		messageLabel.textAlignment = .center
		messageLabel.numberOfLines = 0
		view.addSubview(messageLabel)

		NSLayoutConstraint.activate([
			messageLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
			messageLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
			messageLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -36),
		])
	}

	private func configureSession() {
		guard let captureDevice = AVCaptureDevice.default(for: .video) else {
			messageLabel.text = "Camera unavailable on this device."
			return
		}

		do {
			let input = try AVCaptureDeviceInput(device: captureDevice)
			if session.canAddInput(input) {
				session.addInput(input)
			}

			let output = AVCaptureMetadataOutput()
			if session.canAddOutput(output) {
				session.addOutput(output)
				output.setMetadataObjectsDelegate(self, queue: .main)
				output.metadataObjectTypes = [.qr]
			}

			let preview = AVCaptureVideoPreviewLayer(session: session)
			preview.videoGravity = .resizeAspectFill
			view.layer.insertSublayer(preview, at: 0)
			previewLayer = preview
		} catch {
			messageLabel.text = error.localizedDescription
		}
	}
}
