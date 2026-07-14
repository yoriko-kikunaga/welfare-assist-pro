import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { storage, db } from '../firebaseConfig';
import { ClientDocument, DocumentType } from '../../types';

const CLIENT_EDITS_COLLECTION = 'clientEdits';

/**
 * PDFをFirebase Storageにアップロードし、ドキュメントメタデータを返す
 */
export async function uploadClientDocument(
  aozoraId: string,
  file: File,
  documentType: DocumentType,
  note?: string,
  onProgress?: (percent: number) => void,
  onTaskReady?: (cancelFn: () => void) => void
): Promise<ClientDocument> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `client-documents/${aozoraId}/${id}_${file.name}`;
  const storageRef = ref(storage, storagePath);

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file);
    onTaskReady?.(() => task.cancel());
    task.on(
      'state_changed',
      (snapshot) => {
        onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
      },
      reject,
      () => resolve()
    );
  });

  return {
    id,
    fileName: file.name,
    documentType,
    uploadedAt: new Date().toISOString().slice(0, 10),
    storagePath,
    fileSize: file.size,
    note: note || '',
  };
}

/**
 * Storage からドキュメントを削除する
 */
export async function deleteClientDocument(storagePath: string): Promise<void> {
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
}

/**
 * ダウンロードURL（署名付き）を取得する
 */
export async function getDocumentUrl(storagePath: string): Promise<string> {
  const storageRef = ref(storage, storagePath);
  return getDownloadURL(storageRef);
}

/**
 * 署名済みPDF（Blob）をアップロードし、ドキュメントメタデータを返す
 */
export async function uploadSignedDocument(
  aozoraId: string,
  blob: Blob,
  signedFileName: string,
  documentType: ClientDocument['documentType'],
  originalDocumentId?: string,
  onProgress?: (percent: number) => void
): Promise<ClientDocument> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `client-documents/${aozoraId}/${id}_${signedFileName}`;
  const storageRef = ref(storage, storagePath);
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob);
    task.on(
      'state_changed',
      (snapshot) => {
        onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
      },
      reject,
      () => resolve()
    );
  });
  return {
    id,
    fileName: signedFileName,
    documentType,
    uploadedAt: new Date().toISOString().slice(0, 10),
    storagePath,
    fileSize: blob.size,
    note: '',
    isSigned: true,
    signedAt: new Date().toISOString().slice(0, 10),
    ...(originalDocumentId ? { originalDocumentId } : {}),
  };
}

/**
 * ドキュメントリストだけを Firestore に保存（setDoc merge:true）
 */
export async function saveClientDocumentsMeta(
  aozoraId: string,
  documents: ClientDocument[]
): Promise<void> {
  const docRef = doc(db, CLIENT_EDITS_COLLECTION, aozoraId);
  await setDoc(docRef, {
    aozoraId,
    documents,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
