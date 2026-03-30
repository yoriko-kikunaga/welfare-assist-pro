import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
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
  note?: string
): Promise<ClientDocument> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `client-documents/${aozoraId}/${id}_${file.name}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file);

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
