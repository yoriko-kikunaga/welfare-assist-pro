import React from 'react';
import { Client } from '../types';

interface ClientListProps {
  clients: Client[];
  selectedClientId: string | null;
  onSelectClient: (client: Client) => void;
  onAddClient: () => void;
}

const ClientList: React.FC<ClientListProps> = ({ clients, selectedClientId, onSelectClient, onAddClient }) => {
  return (
    <div className="w-full md:w-80 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
        <h2 className="text-lg font-bold text-gray-700">利用者一覧</h2>
        <button 
          onClick={onAddClient}
          className="bg-primary-600 hover:bg-primary-700 text-white p-2 rounded-full shadow-sm transition-colors"
          title="新規追加"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>
      
      <div className="overflow-y-auto flex-1">
        {clients.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            利用者が登録されていません
          </div>
        ) : (
          <ul>
            {clients.map((client) => (
              <li key={client.id}>
                <button
                  onClick={() => onSelectClient(client)}
                  className={`w-full text-left p-4 border-b border-gray-100 hover:bg-primary-50 transition-all ${
                    selectedClientId === client.id ? 'bg-primary-50 border-l-4 border-l-primary-500' : 'border-l-4 border-l-transparent'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <span className="font-semibold text-gray-800 text-lg">{client.name}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-200 text-gray-600">
                      {client.careLevel}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{client.nameKana}</div>
                  <div className="text-xs text-gray-400 mt-1 truncate">{client.facilityName}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ClientList;